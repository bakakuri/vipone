// Withdrawals: quote (server-computed fees) -> confirm (atomic hold) ->
// staff review/approval -> broadcast -> completion. See the SQL functions in
// supabase/migrations/*_withdrawals.sql for the state machine.

import { getConfig } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { getSql, withTransaction } from '../../db/client.js';
import { camelize, trimAmount, trimAmounts } from '../../utils/camelize.js';
import { pageOf } from '../../utils/schemas.js';
import { explorerTxUrl, getAssetNetwork } from '../assets/assets.repository.js';
import { assertAccountActive, assertKycFor } from '../compliance/compliance.service.js';
import { dispatchSoon, queueEmail } from '../notifications/email-outbox.js';
import { getSetting } from '../settings/settings.service.js';
import { calculateWithdrawalFee } from './calculate-withdrawal-fee.js';

const AMOUNT_FIELDS = ['amount', 'platformFee', 'networkFee', 'netAmount', 'feeRate', 'actualNetworkFee'];

function toApi(row) {
  const w = trimAmounts(camelize(row), AMOUNT_FIELDS);
  w.explorerUrl = explorerTxUrl(row.explorer_tx_url, row.tx_hash);
  delete w.explorerTxUrl;
  delete w.userId;
  delete w.idempotencyKey;
  return w;
}

export async function createQuote(auth, { walletId, amount }) {
  const sql = getSql();
  assertAccountActive(auth);
  await assertKycFor(sql, auth, 'withdrawal');
  const [wallet] = await sql`
    select * from app.withdrawal_wallets where id = ${walletId} and user_id = ${auth.userId} and status = 'active'`;
  if (!wallet) throw new AppError('wallet_not_active', { status: 409 });
  const an = await getAssetNetwork(sql, wallet.asset_code, wallet.network_code);
  if (!an || !an.withdrawalEnabled) throw new AppError('asset_network_not_supported', { status: 422 });
  if (Number.isNaN(Number(amount))) throw new AppError('amount_invalid', { status: 422 });

  const [rule] = await sql`select * from app.active_fee_rule('withdrawal_platform', ${an.assetCode}, ${an.networkCode})`;
  const fee = calculateWithdrawalFee({
    amount,
    rate: rule?.rate ?? '0',
    minFee: rule?.min_fee ?? '0',
    networkFee: an.withdrawalNetworkFee,
    decimals: an.decimals,
  });
  const [{ below }] = await sql`select ${fee.amount}::numeric < ${an.minWithdrawal}::numeric as below`;
  if (below) throw new AppError('amount_below_minimum', { status: 422, details: { value: trimAmount(an.minWithdrawal) } });

  const ttl = Number(await getSetting(sql, 'withdrawal.quote_ttl_seconds', 300)) || 300;
  const [quote] = await sql`
    insert into app.withdrawal_quotes (user_id, wallet_id, asset_code, network_code, amount, platform_fee, network_fee,
                                       net_amount, fee_rule_id, fee_rate, expires_at)
    values (${auth.userId}, ${wallet.id}, ${wallet.asset_code}, ${wallet.network_code}, ${fee.amount}, ${fee.platformFee},
            ${fee.networkFee}, ${fee.netAmount}, ${rule?.id ?? null}, ${fee.feeRate}, now() + ${`${ttl} seconds`}::interval)
    returning *`;
  const [balance] = await sql`select withdrawable from app.user_balances(${auth.userId}) where asset_code = ${wallet.asset_code}`;
  return {
    ...toApi(quote),
    walletLabel: wallet.label,
    address: wallet.address,
    memo: wallet.memo,
    withdrawable: trimAmount(balance?.withdrawable ?? '0'),
  };
}

export async function createWithdrawal(auth, { quoteId }, idempotencyKey) {
  const sql = getSql();
  assertAccountActive(auth);
  await assertKycFor(sql, auth, 'withdrawal');
  const request = await withTransaction(async (tx) => {
    const [row] = await tx`select * from app.create_withdrawal(${auth.userId}, ${quoteId}, ${idempotencyKey})`;
    await queueEmail(tx, {
      to: auth.email,
      template: 'withdrawal_created',
      locale: auth.profile.locale,
      params: {
        reference: row.reference,
        amount: trimAmount(row.amount),
        netAmount: trimAmount(row.net_amount),
        asset: row.asset_code,
        address: row.address,
        actionUrl: `${getConfig().appUrl}/withdrawals`,
      },
    });
    return row;
  });
  await dispatchSoon();
  return toApi(request);
}

export async function cancelWithdrawal(auth, id) {
  return withTransaction(async (tx) => {
    const [row] = await tx`select * from app.cancel_withdrawal(${id}, ${auth.userId})`;
    return toApi(row);
  });
}

export async function listWithdrawals(userId, { status, asset, limit, cursor }) {
  const rows = await getSql()`
    select w.id, w.reference, w.asset_code, w.network_code, w.address, w.memo, w.amount, w.platform_fee, w.network_fee,
           w.net_amount, w.status, w.status_reason, w.tx_hash, w.broadcast_at, w.completed_at, w.created_at, w.updated_at,
           wl.label as wallet_label, n.explorer_tx_url
    from app.withdrawal_requests w
    join app.withdrawal_wallets wl on wl.id = w.wallet_id
    join app.networks n on n.code = w.network_code
    where w.user_id = ${userId}
      and (${status ?? null}::text is null or w.status = ${status ?? null})
      and (${asset ?? null}::text is null or w.asset_code = ${asset ?? null})
      and (${cursor?.t ?? null}::timestamptz is null or (w.created_at, w.id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by w.created_at desc, w.id desc
    limit ${limit + 1}`;
  const page = pageOf(rows, limit);
  return { items: page.items.map(toApi), nextCursor: page.nextCursor };
}

export async function getWithdrawal(userId, id) {
  const [row] = await getSql()`
    select w.id, w.reference, w.asset_code, w.network_code, w.address, w.memo, w.amount, w.platform_fee, w.network_fee,
           w.net_amount, w.status, w.status_reason, w.tx_hash, w.broadcast_at, w.completed_at, w.created_at, w.updated_at,
           w.requires_dual_approval, w.approved_at, wl.label as wallet_label, n.explorer_tx_url
    from app.withdrawal_requests w
    join app.withdrawal_wallets wl on wl.id = w.wallet_id
    join app.networks n on n.code = w.network_code
    where w.id = ${id} and w.user_id = ${userId}`;
  if (!row) throw new AppError('not_found');
  return toApi(row);
}
