// Withdrawal processing by finance staff:
//   pending -> (review) -> approve [x2 above the threshold] -> processing
//   -> record broadcast tx hash -> completed (chain confirmation, or manual
//   verification by a second staff member) | failed (funds confirmed not sent)
// Every step is audited. "Completed" is never a single button press.

import { getConfig } from '../../../config/env.js';
import { AppError } from '../../../core/errors.js';
import { getSql, withTransaction } from '../../../db/client.js';
import { camelize, trimAmount, trimAmounts } from '../../../utils/camelize.js';
import { pageOf } from '../../../utils/schemas.js';
import { audit } from '../../audit/audit.service.js';
import { dispatchSoon, queueEmail } from '../../notifications/email-outbox.js';

const AMOUNTS = ['amount', 'platformFee', 'networkFee', 'netAmount', 'actualNetworkFee'];
const fmt = (r) => trimAmounts(camelize(r), AMOUNTS);

export async function listWithdrawals({ status, asset, search, limit, cursor }) {
  const rows = await getSql()`
    select w.id, w.reference, w.user_id, p.email, w.asset_code, w.network_code, w.address, w.memo, w.amount, w.platform_fee,
           w.network_fee, w.net_amount, w.status, w.status_reason, w.requires_dual_approval, w.approved_by, w.tx_hash,
           w.created_at, w.updated_at
    from app.withdrawal_requests w join app.profiles p on p.id = w.user_id
    where (${status ?? null}::text is null or w.status = ${status ?? null})
      and (${asset ?? null}::text is null or w.asset_code = ${asset ?? null})
      and (${search ?? null}::text is null or w.reference = upper(${search ?? ''}) or w.tx_hash = ${search ?? ''} or lower(p.email) = lower(${search ?? ''}) or w.address = ${search ?? ''})
      and (${cursor?.t ?? null}::timestamptz is null or (w.created_at, w.id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by w.created_at desc, w.id desc limit ${limit + 1}`;
  const page = pageOf(rows, limit);
  return { items: page.items.map(fmt), nextCursor: page.nextCursor };
}

export async function getWithdrawal(id) {
  const sql = getSql();
  const [row] = await sql`
    select w.*, p.email, p.status as user_status, p.kyc_status, p.created_at as user_created_at,
           wl.label as wallet_label, wl.confirmed_at as wallet_confirmed_at, wl.created_at as wallet_created_at,
           n.explorer_tx_url, n.explorer_address_url,
           a1.email as approved_by_email, a2.email as second_approved_by_email, a3.email as processed_by_email
    from app.withdrawal_requests w
    join app.profiles p on p.id = w.user_id
    join app.withdrawal_wallets wl on wl.id = w.wallet_id
    join app.networks n on n.code = w.network_code
    left join app.profiles a1 on a1.id = w.approved_by
    left join app.profiles a2 on a2.id = w.second_approved_by
    left join app.profiles a3 on a3.id = w.processed_by
    where w.id = ${id}`;
  if (!row) throw new AppError('not_found');
  const [flags, history] = await Promise.all([
    sql`select flag_type, severity, status, created_at from app.risk_flags where user_id = ${row.user_id} and status = 'open'`,
    sql`select count(*)::int as completed from app.withdrawal_requests where user_id = ${row.user_id} and status = 'completed'`,
  ]);
  const out = fmt(row);
  out.explorerUrl = row.explorer_tx_url && row.tx_hash ? row.explorer_tx_url.replace('{tx}', row.tx_hash) : null;
  out.addressUrl = row.explorer_address_url ? row.explorer_address_url.replace('{address}', row.address) : null;
  out.openRiskFlags = flags.map(camelize);
  out.completedWithdrawals = history[0].completed;
  return out;
}

async function act(req, id, action, fn, reason) {
  const result = await withTransaction(async (tx) => {
    const [before] = await tx`select status, tx_hash from app.withdrawal_requests where id = ${id}`;
    if (!before) throw new AppError('not_found');
    const row = await fn(tx);
    await audit(tx, req, { action: `withdrawal.${action}`, entityType: 'withdrawal_request', entityId: id, before, after: { status: row.status, txHash: row.tx_hash }, reason });
    return row;
  });
  await dispatchSoon();
  return fmt(result);
}

export const review = (req, id, { reason }) =>
  act(req, id, 'review', async (tx) => (await tx`select * from app.review_withdrawal(${id}, ${req.auth.userId}, ${reason})`)[0], reason);

export const approve = (req, id) =>
  act(req, id, 'approve', async (tx) => (await tx`select * from app.approve_withdrawal(${id}, ${req.auth.userId})`)[0]);

export const reject = (req, id, { reason }) =>
  act(req, id, 'reject', async (tx) => {
    const [row] = await tx`select * from app.reject_withdrawal(${id}, ${req.auth.userId}, ${reason})`;
    await emailUser(tx, row, 'withdrawal_rejected', { reason });
    return row;
  }, reason);

export const startProcessing = (req, id) =>
  act(req, id, 'process', async (tx) => (await tx`select * from app.start_withdrawal_processing(${id}, ${req.auth.userId})`)[0]);

export const recordBroadcast = (req, id, { txHash }) =>
  act(req, id, 'broadcast', async (tx) => (await tx`select * from app.record_withdrawal_broadcast(${id}, ${txHash}, ${req.auth.userId})`)[0]);

export const complete = (req, id, { actualNetworkFee }) =>
  act(req, id, 'complete', async (tx) => {
    const [row] = await tx`select * from app.complete_withdrawal(${id}, ${req.auth.userId}, ${actualNetworkFee ?? null}, 'manual_verification')`;
    await emailUser(tx, row, 'withdrawal_completed', {});
    return row;
  });

// Manual payout: staff sent the funds themselves and record the transaction
// hash; approval (two people above the threshold), processing and completion
// happen in one step (app.pay_withdrawal_manually).
export const pay = (req, id, { txHash, reason }) =>
  act(req, id, 'pay', async (tx) => {
    const [row] = await tx`select * from app.pay_withdrawal_manually(${id}, ${req.auth.userId}, ${txHash})`;
    if (row.status === 'completed') await emailUser(tx, row, 'withdrawal_completed', {});
    return row;
  }, reason);

export const fail = (req, id, { reason, fundsNotSent }) =>
  act(req, id, 'fail', async (tx) => {
    const [row] = await tx`select * from app.fail_withdrawal(${id}, ${req.auth.userId}, ${reason}, ${fundsNotSent})`;
    await emailUser(tx, row, 'withdrawal_failed', { reason });
    return row;
  }, reason);

async function emailUser(tx, row, template, extra) {
  const [p] = await tx`select email, locale from app.profiles where id = ${row.user_id}`;
  await queueEmail(tx, {
    to: p.email,
    template,
    locale: p.locale,
    params: {
      reference: row.reference,
      amount: trimAmount(row.net_amount),
      asset: row.asset_code,
      txHash: row.tx_hash || '',
      actionUrl: `${getConfig().appUrl}/withdrawals`,
      ...extra,
    },
  });
}
