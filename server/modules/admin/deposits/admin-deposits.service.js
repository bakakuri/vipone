// Deposit oversight. Staff can put a deposit on hold, approve a held deposit
// (it is then credited only if the chain confirmations are sufficient) or
// reject it. There is no way to credit a deposit without a recorded chain
// transaction: "approve" never invents funds.

import { AppError } from '../../../core/errors.js';
import { getSql, withTransaction } from '../../../db/client.js';
import { verifyAddressChecksum } from '../../../utils/address-checksum.js';
import { camelize, trimAmount } from '../../../utils/camelize.js';
import { pageOf } from '../../../utils/schemas.js';
import { audit } from '../../audit/audit.service.js';
import { creditConfirmedDeposit } from '../../deposits/deposits.service.js';
import { dispatchSoon } from '../../notifications/email-outbox.js';

const fmt = (r) => ({
  ...camelize(r),
  amount: trimAmount(r.amount),
  expectedAmount: trimAmount(r.expected_amount),
  claimedAmount: trimAmount(r.claimed_amount),
});

export async function listDeposits({ status, asset, network, source, search, limit, cursor }) {
  const rows = await getSql()`
    select d.id, d.reference, d.user_id, p.email, d.asset_code, d.network_code, d.amount, d.expected_amount, d.tx_hash,
           d.confirmations, d.required_confirmations, d.status, d.status_reason, d.risk_result, d.created_at, d.credited_at,
           d.source, d.claimed_amount
    from app.deposits d join app.profiles p on p.id = d.user_id
    where (${source ?? null}::text is null or d.source = ${source ?? null}) and (${status ?? null}::text is null or d.status = ${status ?? null})
      and (${asset ?? null}::text is null or d.asset_code = ${asset ?? null})
      and (${network ?? null}::text is null or d.network_code = ${network ?? null})
      and (${search ?? null}::text is null or d.reference = upper(${search ?? ''}) or d.tx_hash = ${search ?? ''} or lower(p.email) = lower(${search ?? ''}))
      and (${cursor?.t ?? null}::timestamptz is null or (d.created_at, d.id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by d.created_at desc, d.id desc limit ${limit + 1}`;
  const page = pageOf(rows, limit);
  return { items: page.items.map(fmt), nextCursor: page.nextCursor };
}

export async function getDeposit(id) {
  const sql = getSql();
  const [row] = await sql`
    select d.*, p.email, coalesce(a.address, m.address) as address, coalesce(a.memo, m.memo) as memo, n.explorer_tx_url,
           m.label as method_label
    from app.deposits d join app.profiles p on p.id = d.user_id
    join app.networks n on n.code = d.network_code
    left join app.deposit_addresses a on a.id = d.deposit_address_id
    left join app.deposit_methods m on m.id = d.method_id
    where d.id = ${id}`;
  if (!row) throw new AppError('not_found');
  const events = row.tx_hash
    ? await sql`
        select id, provider, provider_event_id, confirmations, block_number, reorged, from_address, received_at, processing_result
        from app.blockchain_events where network_code = ${row.network_code} and tx_hash = ${row.tx_hash} and log_index = ${row.log_index}
        order by received_at`
    : [];
  return { ...fmt(row), explorerUrl: row.explorer_tx_url && row.tx_hash ? row.explorer_tx_url.replace('{tx}', row.tx_hash) : null, events: events.map(camelize) };
}

export async function reviewDeposit(req, id, { decision, reason }) {
  const result = await withTransaction(async (tx) => {
    const [before] = await tx`select status, source from app.deposits where id = ${id}`;
    if (!before) throw new AppError('not_found');
    // A reported payment has no chain record yet: it is approved with the
    // checked amount and transaction hash (approve-manual), not here.
    if (before.source === 'manual' && decision === 'approve') {
      throw new AppError('invalid_status_transition', { status: 409, details: { reason: 'use_manual_approval' } });
    }
    delete before.source;
    let [row] = await tx`select * from app.review_deposit(${id}, ${decision}, ${req.auth.userId}, ${reason})`;
    if (decision === 'approve' && row.status === 'confirmed') {
      await creditConfirmedDeposit(tx, id, { actorId: req.auth.userId, source: 'admin' });
      [row] = await tx`select * from app.deposits where id = ${id}`;
    }
    await audit(tx, req, { action: `deposit.${decision}`, entityType: 'deposit', entityId: id, before, after: { status: row.status }, reason });
    return fmt(row);
  });
  await dispatchSoon();
  return result;
}

export async function returnDeposit(req, id, { txHash }) {
  return withTransaction(async (tx) => {
    const [row] = await tx`select * from app.return_suspense_deposit(${id}, ${txHash}, ${req.auth.userId})`;
    await audit(tx, req, { action: 'deposit.returned', entityType: 'deposit', entityId: id, after: { refundTxHash: txHash } });
    return fmt(row);
  });
}

export async function addressPool() {
  const rows = await getSql()`
    select network_code, status, count(*)::int as count from app.deposit_address_pool group by network_code, status order by network_code`;
  return rows.map(camelize);
}

// Imports addresses generated outside the platform (custody provider or an
// offline HD wallet). For memo networks, a shared address gets unique memos.
export async function importAddresses(req, { network, addresses, sharedAddress, memoCount }) {
  const sql = getSql();
  const [net] = await sql`select * from app.networks where code = ${network}`;
  if (!net) throw new AppError('not_found');
  let rows;
  if (net.memo_required) {
    if (!sharedAddress || !memoCount) throw new AppError('validation_failed', { details: [{ path: 'body.sharedAddress', code: 'required' }] });
    if (!new RegExp(net.address_pattern).test(sharedAddress)) throw new AppError('validation_failed', { details: [{ path: 'body.sharedAddress', code: 'address_invalid' }] });
    const [{ max }] = await sql`
      select coalesce(max(memo::bigint), 100000) as max from app.deposit_address_pool where network_code = ${network} and memo ~ '^[0-9]+$'`;
    rows = Array.from({ length: memoCount }, (_, i) => ({ address: sharedAddress, memo: String(BigInt(max) + BigInt(i + 1)) }));
  } else {
    const pattern = new RegExp(net.address_pattern);
    const invalid = addresses.filter((a) => !pattern.test(a) || !verifyAddressChecksum(net.family, a));
    if (invalid.length) throw new AppError('validation_failed', { details: invalid.slice(0, 20).map((a) => ({ path: 'body.addresses', code: 'address_invalid', value: a })) });
    rows = [...new Set(addresses)].map((address) => ({ address, memo: null }));
  }
  return withTransaction(async (tx) => {
    let inserted = 0;
    for (const r of rows) {
      const res = await tx`
        insert into app.deposit_address_pool (network_code, address, memo, imported_by)
        values (${network}, ${r.address}, ${r.memo}, ${req.auth.userId}) on conflict do nothing returning id`;
      inserted += res.length;
    }
    await audit(tx, req, { action: 'address_pool.imported', entityType: 'network', entityId: network, after: { submitted: rows.length, inserted } });
    return { submitted: rows.length, inserted, skipped: rows.length - inserted };
  });
}
