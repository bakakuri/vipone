// Staff management of published deposit methods (address, memo, QR image,
// instructions per language) and approval of payments users reported.
// Every change is written to the audit log with before/after values.

import { AppError } from '../../../core/errors.js';
import { hasAtMostDecimals } from '../../../core/money.js';
import { getSql, withTransaction } from '../../../db/client.js';
import { camelize, trimAmount } from '../../../utils/camelize.js';
import { audit } from '../../audit/audit.service.js';
import { creditConfirmedDeposit } from '../../deposits/deposits.service.js';
import { methodToApi } from '../../deposits/deposit-methods.service.js';
import { dispatchSoon } from '../../notifications/email-outbox.js';

const SELECT = (sql) => sql`
  select m.*, n.name as network_name, n.memo_label
  from app.deposit_methods m join app.networks n on n.code = m.network_code`;

export async function listMethods() {
  const sql = getSql();
  const rows = await sql`${SELECT(sql)} order by m.sort_order, m.asset_code, m.network_code`;
  return rows.map(methodToApi);
}

async function assertPair(tx, asset, network) {
  const [pair] = await tx`select 1 from app.asset_networks where asset_code = ${asset} and network_code = ${network}`;
  if (!pair) throw new AppError('asset_network_not_supported', { status: 422 });
}

function columns(body) {
  return {
    asset_code: body.asset,
    network_code: body.network,
    label: body.label || null,
    address: body.address.trim(),
    memo: body.memo?.trim() || null,
    qr_image: body.qrImage || null,
    instructions: body.instructions || {},
    min_amount: body.minAmount || null,
    is_active: body.isActive ?? true,
    sort_order: body.sortOrder ?? 0,
  };
}

export async function createMethod(req, body) {
  return withTransaction(async (tx) => {
    await assertPair(tx, body.asset, body.network);
    const c = columns(body);
    let row;
    try {
      [row] = await tx`
        insert into app.deposit_methods (asset_code, network_code, label, address, memo, qr_image, instructions, min_amount, is_active, sort_order, created_by, updated_by)
        values (${c.asset_code}, ${c.network_code}, ${c.label}, ${c.address}, ${c.memo}, ${c.qr_image}, ${tx.json(c.instructions)}, ${c.min_amount}, ${c.is_active}, ${c.sort_order}, ${req.auth.userId}, ${req.auth.userId})
        returning id`;
    } catch (err) {
      if (err.code === '23505') throw new AppError('conflict', { status: 409, details: { reason: 'method_exists' } });
      throw err;
    }
    await audit(tx, req, { action: 'deposit_method.created', entityType: 'deposit_method', entityId: row.id, after: { ...c, qr_image: c.qr_image ? 'uploaded' : null } });
    const [full] = await tx`${SELECT(tx)} where m.id = ${row.id}`;
    return methodToApi(full);
  });
}

export async function updateMethod(req, id, body) {
  return withTransaction(async (tx) => {
    const [before] = await tx`select * from app.deposit_methods where id = ${id} for update`;
    if (!before) throw new AppError('not_found');
    await assertPair(tx, body.asset, body.network);
    const c = columns(body);
    // qrImage: undefined keeps the current image, null removes it.
    const qr = body.qrImage === undefined ? before.qr_image : c.qr_image;
    try {
      await tx`
        update app.deposit_methods set asset_code = ${c.asset_code}, network_code = ${c.network_code}, label = ${c.label},
          address = ${c.address}, memo = ${c.memo}, qr_image = ${qr}, instructions = ${tx.json(c.instructions)},
          min_amount = ${c.min_amount}, is_active = ${c.is_active}, sort_order = ${c.sort_order}, updated_by = ${req.auth.userId}
        where id = ${id}`;
    } catch (err) {
      if (err.code === '23505') throw new AppError('conflict', { status: 409, details: { reason: 'method_exists' } });
      throw err;
    }
    const strip = (r) => ({ asset: r.asset_code, network: r.network_code, address: r.address, memo: r.memo, active: r.is_active, minAmount: trimAmount(r.min_amount), qrImage: r.qr_image ? 'set' : null });
    const [afterRow] = await tx`select * from app.deposit_methods where id = ${id}`;
    await audit(tx, req, { action: 'deposit_method.updated', entityType: 'deposit_method', entityId: id, before: strip(before), after: strip(afterRow) });
    const [full] = await tx`${SELECT(tx)} where m.id = ${id}`;
    return methodToApi(full);
  });
}

// Methods referenced by reported deposits are deactivated instead of deleted.
export async function removeMethod(req, id) {
  return withTransaction(async (tx) => {
    const [before] = await tx`select * from app.deposit_methods where id = ${id} for update`;
    if (!before) throw new AppError('not_found');
    const [used] = await tx`select 1 from app.deposits where method_id = ${id} limit 1`;
    if (used) await tx`update app.deposit_methods set is_active = false, updated_by = ${req.auth.userId} where id = ${id}`;
    else await tx`delete from app.deposit_methods where id = ${id}`;
    await audit(tx, req, { action: used ? 'deposit_method.deactivated' : 'deposit_method.deleted', entityType: 'deposit_method', entityId: id, before: { asset: before.asset_code, network: before.network_code, address: before.address } });
    return { removed: !used, deactivated: Boolean(used) };
  });
}

async function creditReport(tx, req, id, { amount, txHash, reason }, action = 'deposit.manual_approved') {
  const [dep] = await tx`select d.status, d.asset_code, a.decimals from app.deposits d join app.assets a on a.code = d.asset_code where d.id = ${id}`;
  if (!dep) throw new AppError('not_found');
  if (amount && !hasAtMostDecimals(amount, dep.decimals)) throw new AppError('amount_precision', { status: 422 });
  await tx`select * from app.approve_manual_deposit(${id}, ${req.auth.userId}, ${amount ?? null}, ${txHash ?? null})`;
  await creditConfirmedDeposit(tx, id, { actorId: req.auth.userId, source: 'admin' });
  const [row] = await tx`select * from app.deposits where id = ${id}`;
  await audit(tx, req, {
    action, entityType: 'deposit', entityId: id,
    before: { status: dep.status }, after: { status: row.status, amount: trimAmount(row.amount), txHash: row.tx_hash }, reason,
  });
  return { ...camelize(row), amount: trimAmount(row.amount), claimedAmount: trimAmount(row.claimed_amount) };
}

export async function approveManual(req, id, body) {
  const result = await withTransaction((tx) => creditReport(tx, req, id, body));
  await dispatchSoon();
  return result;
}

// Staff record a payment they received for a user (e.g. the user wrote to
// support instead of pressing "I have sent it"): the deposit is created
// against the published method and credited at once — the same ledger
// posting, hold, referral reward and email as any deposit, so the platform's
// custody figure includes the money.
export async function addDepositForUser(req, { userId, asset = 'USDT', amount, txHash, reason }) {
  const result = await withTransaction(async (tx) => {
    const [user] = await tx`select id from app.profiles where id = ${userId}`;
    if (!user) throw new AppError('not_found');
    const [method] = await tx`
      select m.id from app.deposit_methods m
      join app.asset_networks an on an.asset_code = m.asset_code and an.network_code = m.network_code
      where m.asset_code = ${asset} and m.is_active and an.deposit_enabled
      order by m.sort_order, m.created_at limit 1`;
    if (!method) throw new AppError('no_deposit_method', { status: 409 });
    const [dep] = await tx`select * from app.submit_manual_deposit(${userId}, ${method.id}, ${amount}, ${txHash}, ${'Added by staff'}, ${null})`;
    return creditReport(tx, req, dep.id, { amount, txHash, reason }, 'deposit.added_by_staff');
  });
  await dispatchSoon();
  return result;
}
