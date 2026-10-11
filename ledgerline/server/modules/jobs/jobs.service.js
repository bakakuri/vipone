// Scheduled jobs. Each run is recorded in app.job_runs (visible in the admin
// system-health view). Jobs are idempotent and safe to run concurrently:
// the SQL functions lock rows with SKIP LOCKED.

import { getConfig } from '../../config/env.js';
import { logger, serializeError } from '../../core/logger.js';
import { getSql, withTransaction } from '../../db/client.js';
import { confirmationsFrom, getTipHeight } from '../../integrations/blockchain/chain-tip.js';
import { getPriceProvider } from '../../integrations/prices/index.js';
import { ingestChainEvents } from '../deposits/deposits.service.js';
import { dispatchPendingEmails } from '../notifications/email-outbox.js';

async function processMaturities() {
  return withTransaction(async (tx) => {
    const rows = await tx`select * from app.process_due_positions(200)`;
    return { processed: rows.length, released: rows.filter((r) => r.new_status === 'matured').length };
  });
}

async function releaseReferralRewards() {
  return withTransaction(async (tx) => {
    const rows = await tx`select * from app.release_due_referral_rewards(200)`;
    const by = {};
    for (const r of rows) by[r.outcome] = (by[r.outcome] || 0) + 1;
    return { processed: rows.length, ...by };
  });
}

async function expireDepositRequests() {
  const [row] = await getSql()`select app.expire_deposit_requests() as expired`;
  return { expired: row.expired };
}

async function expireApprovals() {
  const rows = await getSql()`
    update app.admin_approvals set status = 'expired' where status = 'pending' and expires_at <= now() returning id`;
  return { expired: rows.length };
}

// Updates confirmation counts of detected deposits from the chain tip.
async function refreshConfirmations() {
  const sql = getSql();
  const { blockchain } = getConfig();
  const pending = await sql`
    select d.id, d.network_code, n.family, d.tx_hash, d.log_index, d.confirmations, d.asset_code, d.amount,
           a.address, a.memo, d.from_address,
           (select max(b.block_number) from app.blockchain_events b
             where b.network_code = d.network_code and b.tx_hash = d.tx_hash and b.log_index = d.log_index) as block_number
    from app.deposits d
    join app.networks n on n.code = d.network_code
    join app.deposit_addresses a on a.id = d.deposit_address_id
    where d.status in ('detected', 'confirming') and d.tx_hash is not null
    limit 500`;
  const tips = {};
  const events = [];
  for (const d of pending) {
    if (d.block_number === null) continue;
    try {
      tips[d.network_code] ??= await getTipHeight(d.family, blockchain.rpcUrls[d.network_code]);
    } catch (err) {
      tips[d.network_code] = null;
      logger.warn('chain_tip_unavailable', { network: d.network_code, error: err.message });
    }
    const tip = tips[d.network_code];
    if (tip === null || tip === undefined) continue;
    const confirmations = confirmationsFrom(tip, Number(d.block_number));
    if (confirmations <= d.confirmations) continue;
    events.push({
      providerEventId: `${d.network_code}:${d.tx_hash}:${d.log_index}:c${confirmations}`,
      network: d.network_code,
      txHash: d.tx_hash,
      logIndex: d.log_index,
      toAddress: d.address,
      memo: d.memo,
      fromAddress: d.from_address,
      asset: d.asset_code,
      amount: d.amount,
      confirmations,
      blockNumber: Number(d.block_number),
      reorged: false,
      raw: { source: 'confirmation-poller', tip },
    });
  }
  const results = events.length ? await ingestChainEvents('confirmation-poller', events) : [];
  return { checked: pending.length, updated: results.length };
}

async function fetchPrices() {
  const sql = getSql();
  const assets = (await sql`select code from app.assets where is_active`).map((r) => r.code);
  const provider = getPriceProvider();
  const prices = await provider.fetchPrices(assets);
  for (const [asset, price] of Object.entries(prices)) {
    await sql`insert into app.asset_prices (asset_code, quote_currency, price, source) values (${asset}, 'USD', ${price}, ${provider.name})`;
  }
  await sql`delete from app.asset_prices where captured_at < now() - interval '90 days'`;
  return { updated: Object.keys(prices).length };
}

async function cleanup() {
  const sql = getSql();
  const keys = await sql`delete from app.idempotency_keys where created_at < now() - interval '7 days' returning key`;
  const buckets = await sql`delete from app.rate_limit_buckets where window_start < now() - interval '1 day' returning bucket`;
  const codes = await sql`delete from app.verification_codes where expires_at < now() - interval '30 days' returning id`;
  const quotes = await sql`
    delete from app.withdrawal_quotes q where q.used_at is null and q.expires_at < now() - interval '1 day'
      and not exists (select 1 from app.withdrawal_requests w where w.quote_id = q.id) returning id`;
  return { idempotencyKeys: keys.length, rateLimitBuckets: buckets.length, verificationCodes: codes.length, quotes: quotes.length };
}

export const JOBS = {
  'process-maturities': processMaturities,
  'release-referral-rewards': releaseReferralRewards,
  'expire-deposit-requests': expireDepositRequests,
  'expire-approvals': expireApprovals,
  'refresh-confirmations': refreshConfirmations,
  'dispatch-emails': () => dispatchPendingEmails({ limit: 50 }),
  'fetch-prices': fetchPrices,
  cleanup,
};

export const JOB_GROUPS = {
  frequent: ['refresh-confirmations', 'process-maturities', 'release-referral-rewards', 'expire-deposit-requests', 'expire-approvals', 'dispatch-emails'],
  daily: ['fetch-prices', 'cleanup'],
};

export async function runJob(name) {
  const sql = getSql();
  const [run] = await sql`insert into app.job_runs (job_name, status) values (${name}, 'running') returning id`;
  try {
    const result = await JOBS[name]();
    await sql`update app.job_runs set status = 'succeeded', result = ${sql.json(result ?? {})}, finished_at = now() where id = ${run.id}`;
    return { job: name, status: 'succeeded', result };
  } catch (err) {
    await sql`update app.job_runs set status = 'failed', error = ${String(err.message).slice(0, 1000)}, finished_at = now() where id = ${run.id}`;
    logger.error('job_failed', { job: name, error: serializeError(err) });
    return { job: name, status: 'failed', error: err.code || 'job_failed' };
  }
}

export async function runGroup(group) {
  const results = [];
  for (const name of JOB_GROUPS[group]) results.push(await runJob(name));
  return results;
}
