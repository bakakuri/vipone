// Deposit methods published by staff (address, memo, QR, instructions) and
// payments reported by users against them. A report is a claim only: it is
// credited after staff check it on chain (admin-deposit-methods.service.js).

import { AppError } from '../../core/errors.js';
import { hasAtMostDecimals } from '../../core/money.js';
import { getSql, withTransaction } from '../../db/client.js';
import { camelize, trimAmount } from '../../utils/camelize.js';
import { assertAccountActive, assertKycFor } from '../compliance/compliance.service.js';
import { getSetting } from '../settings/settings.service.js';

export function methodToApi(row) {
  return {
    id: row.id,
    asset: row.asset_code,
    network: row.network_code,
    networkName: row.network_name ?? row.network_code,
    label: row.label,
    address: row.address,
    memo: row.memo,
    memoLabel: row.memo_label ?? null,
    qrImage: row.qr_image,
    instructions: row.instructions || {},
    minAmount: trimAmount(row.min_amount),
    isActive: row.is_active,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function listActiveMethods() {
  const sql = getSql();
  const rows = await sql`
    select m.*, n.name as network_name, n.memo_label
    from app.deposit_methods m join app.networks n on n.code = m.network_code
    join app.assets a on a.code = m.asset_code
    where m.is_active and a.is_active
    order by m.sort_order, a.sort_order, m.network_code`;
  const notice = await getSetting(sql, 'deposits.page_notice', {});
  return { methods: rows.map(methodToApi), notice: notice || {} };
}

export async function submitManualDeposit(auth, { methodId, amount, txHash, note }) {
  assertAccountActive(auth);
  const sql = getSql();
  await assertKycFor(sql, auth, 'deposit_address');
  const [method] = await sql`
    select m.asset_code, a.decimals from app.deposit_methods m join app.assets a on a.code = m.asset_code where m.id = ${methodId}`;
  if (!method) throw new AppError('deposit_method_unavailable', { status: 409 });
  if (!hasAtMostDecimals(amount, method.decimals)) throw new AppError('amount_precision', { status: 422 });
  return withTransaction(async (tx) => {
    const [row] = await tx`select * from app.submit_manual_deposit(${auth.userId}, ${methodId}, ${amount}, ${txHash ?? null}, ${note ?? null})`;
    const d = camelize(row);
    return { ...d, amount: trimAmount(row.amount), claimedAmount: trimAmount(row.claimed_amount) };
  });
}
