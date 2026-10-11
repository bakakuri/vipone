// User-facing investment operations. Opening a position moves funds from
// `available` to `invested` atomically and freezes the product terms version
// the user accepted. Nothing here estimates or credits returns: results come
// only from approved, posted period results (see admin/investments).

import { AppError } from '../../core/errors.js';
import { hasAtMostDecimals } from '../../core/money.js';
import { getSql, withTransaction } from '../../db/client.js';
import { camelize, trimAmounts } from '../../utils/camelize.js';
import { getAsset } from '../assets/assets.repository.js';
import { assertAccountActive, assertKycFor } from '../compliance/compliance.service.js';
import { calculateInvestmentPeriod } from './calculate-investment-period.js';
import * as repo from './investments.repository.js';

export async function listProducts() {
  const sql = getSql();
  const products = await repo.listProducts(sql);
  return Promise.all(products.map(async (p) => ({ ...p, results: await repo.productResults(sql, p.id, 12) })));
}

export async function getProductBySlug(slug) {
  const sql = getSql();
  const [product] = await repo.listProducts(sql, { slug });
  if (!product) throw new AppError('not_found');
  return { ...product, results: await repo.productResults(sql, product.id, 24) };
}

export async function listPositions(userId, { status } = {}) {
  const positions = await repo.listPositions(getSql(), userId, { status });
  const now = new Date();
  return positions.map((p) => ({ ...p, period: calculateInvestmentPeriod({ startedAt: p.startedAt, maturityAt: p.maturityAt, now }) }));
}

export async function getPosition(userId, id) {
  const position = await repo.getPosition(getSql(), userId, id);
  if (!position) throw new AppError('not_found');
  return { ...position, period: calculateInvestmentPeriod({ startedAt: position.startedAt, maturityAt: position.maturityAt }) };
}

export async function openPosition(auth, { productId, asset, amount, termsVersion }, idempotencyKey) {
  const sql = getSql();
  assertAccountActive(auth);
  await assertKycFor(sql, auth, 'investment');
  const assetRow = await getAsset(sql, asset);
  if (!assetRow) throw new AppError('asset_not_supported_by_product', { status: 422 });
  if (!hasAtMostDecimals(amount, assetRow.decimals)) throw new AppError('amount_precision', { status: 422 });
  return withTransaction(async (tx) => {
    const [row] = await tx`
      select * from app.open_position(${auth.userId}, ${productId}, ${asset}, ${amount}, ${idempotencyKey}, ${termsVersion})`;
    const out = trimAmounts(camelize(row), ['principal']);
    delete out.userId;
    delete out.idempotencyKey;
    return out;
  });
}

export async function closeEarly(auth, positionId) {
  assertAccountActive(auth);
  return withTransaction(async (tx) => {
    const [owned] = await tx`select id from app.investment_positions where id = ${positionId} and user_id = ${auth.userId} for update`;
    if (!owned) throw new AppError('not_found');
    const [row] = await tx`select * from app.release_position(${positionId}, 'user', ${auth.userId}, true)`;
    const out = trimAmounts(camelize(row), ['principal', 'releasedAmount', 'earlyExitFee']);
    delete out.userId;
    delete out.idempotencyKey;
    return out;
  });
}
