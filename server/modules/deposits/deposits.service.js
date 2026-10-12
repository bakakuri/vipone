// Deposits: address assignment, deposit requests, chain-event ingestion and
// crediting. Ingestion is the only path that credits money, and it runs inside
// one database transaction per event: record -> apply -> screen -> credit ->
// referral reward. A replayed webhook is a no-op.

import { getConfig } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { hasAtMostDecimals } from '../../core/money.js';
import { logger } from '../../core/logger.js';
import { getSql, withTransaction } from '../../db/client.js';
import { getScreeningProvider } from '../../integrations/screening/index.js';
import { camelize, trimAmount } from '../../utils/camelize.js';
import { pageOf } from '../../utils/schemas.js';
import { assetByTokenContract, explorerTxUrl, getAssetNetwork } from '../assets/assets.repository.js';
import { assertAccountActive, assertKycFor } from '../compliance/compliance.service.js';
import { onDepositCredited } from '../referrals/referrals.service.js';
import { getSetting } from '../settings/settings.service.js';
import { dispatchSoon, queueEmail } from '../notifications/email-outbox.js';

function toApi(row) {
  const d = camelize(row);
  return {
    ...d,
    amount: trimAmount(row.amount),
    expectedAmount: trimAmount(row.expected_amount),
    claimedAmount: trimAmount(row.claimed_amount),
    explorerUrl: explorerTxUrl(row.explorer_tx_url, row.tx_hash),
    explorerTxUrl: undefined,
  };
}

export async function getDepositAddress(auth, networkCode) {
  const sql = getSql();
  assertAccountActive(auth);
  await assertKycFor(sql, auth, 'deposit_address');
  return withTransaction(async (tx) => {
    const [row] = await tx`select * from app.assign_deposit_address(${auth.userId}, ${networkCode})`;
    const [net] = await tx`select memo_label, required_confirmations from app.networks where code = ${networkCode}`;
    return {
      network: row.network_code,
      address: row.address,
      memo: row.memo,
      memoLabel: net.memo_label,
      requiredConfirmations: net.required_confirmations,
    };
  });
}

export async function createDepositRequest(auth, { asset, network, expectedAmount }) {
  const sql = getSql();
  assertAccountActive(auth);
  await assertKycFor(sql, auth, 'deposit_address');
  const an = await getAssetNetwork(sql, asset, network);
  if (!an || !an.depositEnabled) throw new AppError('asset_network_not_supported', { status: 422 });
  if (expectedAmount && !hasAtMostDecimals(expectedAmount, an.decimals)) throw new AppError('amount_precision', { status: 422 });
  const ttl = Number(await getSetting(sql, 'deposits.request_ttl_hours', 24)) || 24;
  return withTransaction(async (tx) => {
    const [row] = await tx`
      select * from app.create_deposit_request(${auth.userId}, ${asset}, ${network}, ${expectedAmount ?? null}, ${ttl})`;
    const [addr] = await tx`select address, memo from app.deposit_addresses where id = ${row.deposit_address_id}`;
    return { ...toApi(row), address: addr.address, memo: addr.memo };
  });
}

export async function listDeposits(userId, { status, asset, limit, cursor }) {
  const rows = await getSql()`
    select d.id, d.reference, d.asset_code, d.network_code, d.expected_amount, d.amount, d.tx_hash, d.confirmations,
           d.required_confirmations, d.status, d.status_reason, d.expires_at, d.detected_at, d.confirmed_at,
           d.credited_at, d.created_at, d.updated_at, d.source, d.claimed_amount, n.explorer_tx_url,
           coalesce(a.address, m.address) as address, coalesce(a.memo, m.memo) as memo
    from app.deposits d
    join app.networks n on n.code = d.network_code
    left join app.deposit_addresses a on a.id = d.deposit_address_id
    left join app.deposit_methods m on m.id = d.method_id
    where d.user_id = ${userId}
      and (${status ?? null}::text is null or d.status = ${status ?? null})
      and (${asset ?? null}::text is null or d.asset_code = ${asset ?? null})
      and (${cursor?.t ?? null}::timestamptz is null or (d.created_at, d.id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by d.created_at desc, d.id desc
    limit ${limit + 1}`;
  const page = pageOf(rows, limit);
  return { items: page.items.map(toApi), nextCursor: page.nextCursor };
}

export async function getDeposit(userId, id) {
  const [row] = await getSql()`
    select d.*, n.explorer_tx_url, coalesce(a.address, m.address) as address, coalesce(a.memo, m.memo) as memo
    from app.deposits d join app.networks n on n.code = d.network_code
    left join app.deposit_addresses a on a.id = d.deposit_address_id
    left join app.deposit_methods m on m.id = d.method_id
    where d.id = ${id} and d.user_id = ${userId}`;
  if (!row) throw new AppError('not_found');
  const out = toApi(row);
  delete out.userId;
  delete out.riskResult;
  delete out.reviewedBy;
  return out;
}

// --- Chain events -------------------------------------------------------------------

async function resolveEvent(sql, e) {
  let asset = e.asset;
  if (!asset && e.tokenContract) asset = await assetByTokenContract(sql, e.network, e.tokenContract);
  const [incoming] = await sql`
    select 1 from app.deposit_addresses
    where network_code = ${e.network} and address = ${e.toAddress} and coalesce(memo, '') = ${e.memo || ''}`;
  if (incoming) return { asset, direction: 'incoming' };
  const [outgoing] = await sql`select 1 from app.withdrawal_requests where network_code = ${e.network} and tx_hash = ${e.txHash}`;
  if (outgoing) return { asset, direction: 'outgoing' };
  return { asset, direction: 'incoming' };
}

// Credits a confirmed deposit and creates the referral reward, in `tx`.
export async function creditConfirmedDeposit(tx, depositId, { actorId = null, source = 'webhook' } = {}) {
  const [{ credit_deposit: ledgerTx }] = await tx`select app.credit_deposit(${depositId}, ${actorId}, ${source})`;
  const [deposit] = await tx`select * from app.deposits where id = ${depositId}`;
  await onDepositCredited(tx, deposit);
  const [profile] = await tx`select email, locale from app.profiles where id = ${deposit.user_id}`;
  await queueEmail(tx, {
    to: profile.email,
    template: 'deposit_credited',
    locale: profile.locale,
    params: { amount: trimAmount(deposit.amount), asset: deposit.asset_code, reference: deposit.reference, actionUrl: `${getConfig().appUrl}/deposit` },
  });
  return ledgerTx;
}

export async function ingestChainEvents(provider, events) {
  const sql = getSql();
  const screening = getScreeningProvider();
  const config = getConfig();
  const results = [];
  for (const e of events) {
    const { asset, direction } = await resolveEvent(sql, e);
    // Screening is a network call: done before opening the transaction.
    const screen =
      direction === 'incoming' && e.fromAddress && !e.reorged
        ? await screening.screenAddress({ network: e.network, address: e.fromAddress, direction: 'incoming' })
        : { result: 'unknown' };

    const outcome = await withTransaction(async (tx) => {
      const [rec] = await tx`
        select * from app.record_chain_event(
          ${provider}, ${e.providerEventId}, ${e.network}, ${direction}, ${e.txHash}, ${e.logIndex ?? 0},
          ${e.toAddress}, ${e.memo ?? null}, ${e.fromAddress ?? null}, ${asset ?? null}, ${e.amount},
          ${e.confirmations ?? 0}, ${e.blockNumber ?? null}, ${e.blockHash ?? null}, ${Boolean(e.reorged)},
          ${tx.json({ ...e.raw, networkFee: e.networkFee ?? null })})`;

      if (direction === 'outgoing') {
        const [r] = await tx`select * from app.apply_outgoing_event(${rec.event_id})`;
        return { eventId: rec.event_id, direction, withdrawalId: r.withdrawal_id, status: r.withdrawal_status, outcome: r.outcome };
      }

      const [applied] = await tx`select * from app.apply_incoming_event(${rec.event_id})`;
      let status = applied.deposit_status;
      if (applied.deposit_id && status === 'confirmed') {
        const [dep] = await tx`select risk_result from app.deposits where id = ${applied.deposit_id}`;
        const flagged = screen.result === 'flagged';
        const unscreenedLive = config.isLive && screen.result !== 'clear';
        if (flagged || unscreenedLive) {
          await tx`update app.deposits set risk_result = ${flagged ? 'flagged' : 'unknown'} where id = ${applied.deposit_id}`;
          await tx`select app.review_deposit(${applied.deposit_id}, 'hold', null, ${flagged ? 'screening_flagged' : 'screening_unavailable'})`;
          if (flagged) {
            await tx`
              insert into app.risk_flags (user_id, flag_type, severity, details)
              select user_id, 'screening_hit', 'high', ${tx.json({ depositId: applied.deposit_id, reference: screen.reference })}
              from app.deposits where id = ${applied.deposit_id}`;
          }
          status = 'under_review';
        } else if (dep.risk_result !== 'flagged') {
          if (screen.result === 'clear') await tx`update app.deposits set risk_result = 'clear' where id = ${applied.deposit_id}`;
          await creditConfirmedDeposit(tx, applied.deposit_id, { source: 'webhook' });
          status = 'credited';
        }
      }
      return { eventId: rec.event_id, direction, depositId: applied.deposit_id, status, outcome: applied.outcome };
    });
    results.push(outcome);
  }
  if (results.some((r) => r.status === 'credited')) await dispatchSoon();
  logger.info('chain_events_ingested', { provider, count: results.length });
  return results;
}
