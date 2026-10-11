// Investment products and realised results.
//
// Products: created as drafts; activation requires approved legal status, a
// legal reference, a revenue model and texts in all three languages (enforced
// by a database CHECK constraint as well). Changing terms creates a new
// immutable terms version; open positions keep the version they accepted.
//
// Results: finance records the realised return of a period with evidence
// (statement, report id). A SECOND staff member approves. Posting allocates the
// result to the positions that were open during the period, pays referral
// rewards on realised profit, and releases positions waiting for settlement.

import { AppError } from '../../../core/errors.js';
import { getSql, withTransaction } from '../../../db/client.js';
import { camelize, trimAmount, trimAmounts } from '../../../utils/camelize.js';
import { audit } from '../../audit/audit.service.js';
import { allocateResult } from '../../investments/calculate-position-result.js';
import { productToApi } from '../../investments/investments.repository.js';
import { onResultPosted } from '../../referrals/referrals.service.js';

const LOCALES = ['en', 'ru', 'ar'];
const complete = (obj) => obj && LOCALES.every((l) => typeof obj[l] === 'string' && obj[l].trim());

export async function listProducts() {
  const rows = await getSql()`
    select p.*, coalesce((select array_agg(asset_code order by asset_code) from app.investment_product_assets where product_id = p.id), '{}') as assets,
           coalesce((select sum(principal) from app.investment_positions where product_id = p.id and status in ('active', 'awaiting_settlement')), 0) as allocated,
           (select count(*)::int from app.investment_positions where product_id = p.id and status in ('active', 'awaiting_settlement')) as open_positions
    from app.investment_products p order by p.created_at desc`;
  return rows.map(productToApi);
}

export async function createProduct(req, input) {
  return withTransaction(async (tx) => {
    const [row] = await tx`
      insert into app.investment_products (slug, name, summary, risk_disclosure, revenue_model, revenue_model_description, term_days,
        min_amount, max_amount, capacity, performance_fee_rate, early_exit_allowed, early_exit_fee_rate, risk_level, legal_status,
        legal_reference, status, created_by)
      values (${input.slug}, ${tx.json(input.name)}, ${tx.json(input.summary)}, ${tx.json(input.riskDisclosure)}, ${input.revenueModel},
        ${tx.json(input.revenueModelDescription)}, ${input.termDays}, ${input.minAmount}, ${input.maxAmount ?? null}, ${input.capacity ?? null},
        ${input.performanceFeeRate}, ${input.earlyExitAllowed}, ${input.earlyExitFeeRate}, ${input.riskLevel}, ${input.legalStatus},
        ${input.legalReference ?? null}, 'draft', ${req.auth.userId})
      returning *`;
    for (const asset of input.assets) await tx`insert into app.investment_product_assets (product_id, asset_code) values (${row.id}, ${asset})`;
    await audit(tx, req, { action: 'product.created', entityType: 'investment_product', entityId: row.id, after: input });
    return productToApi(row);
  });
}

export async function updateProduct(req, id, input) {
  return withTransaction(async (tx) => {
    const [before] = await tx`select * from app.investment_products where id = ${id} for update`;
    if (!before) throw new AppError('not_found');
    const [row] = await tx`
      update app.investment_products set
        name = coalesce(${input.name ? tx.json(input.name) : null}, name),
        summary = coalesce(${input.summary ? tx.json(input.summary) : null}, summary),
        risk_disclosure = coalesce(${input.riskDisclosure ? tx.json(input.riskDisclosure) : null}, risk_disclosure),
        revenue_model = coalesce(${input.revenueModel ?? null}, revenue_model),
        revenue_model_description = coalesce(${input.revenueModelDescription ? tx.json(input.revenueModelDescription) : null}, revenue_model_description),
        term_days = coalesce(${input.termDays ?? null}, term_days),
        min_amount = coalesce(${input.minAmount ?? null}, min_amount),
        max_amount = case when ${'maxAmount' in input} then ${input.maxAmount ?? null}::numeric else max_amount end,
        capacity = case when ${'capacity' in input} then ${input.capacity ?? null}::numeric else capacity end,
        performance_fee_rate = coalesce(${input.performanceFeeRate ?? null}, performance_fee_rate),
        early_exit_allowed = coalesce(${input.earlyExitAllowed ?? null}, early_exit_allowed),
        early_exit_fee_rate = coalesce(${input.earlyExitFeeRate ?? null}, early_exit_fee_rate),
        risk_level = coalesce(${input.riskLevel ?? null}, risk_level),
        legal_status = coalesce(${input.legalStatus ?? null}, legal_status),
        legal_reference = coalesce(${input.legalReference ?? null}, legal_reference)
      where id = ${id} returning *`;
    if (input.assets) {
      await tx`delete from app.investment_product_assets where product_id = ${id} and asset_code not in ${tx(input.assets)}`;
      for (const asset of input.assets) await tx`insert into app.investment_product_assets values (${id}, ${asset}) on conflict do nothing`;
    }
    await audit(tx, req, { action: 'product.updated', entityType: 'investment_product', entityId: id, before: productToApi(before), after: input });
    return productToApi(row);
  });
}

export async function setProductStatus(req, id, status) {
  return withTransaction(async (tx) => {
    const [p] = await tx`select * from app.investment_products where id = ${id} for update`;
    if (!p) throw new AppError('not_found');
    if (status === 'active') {
      const missing = [];
      if (p.legal_status !== 'approved') missing.push('legal_status_approved');
      if (!p.legal_reference || p.legal_reference.length < 3) missing.push('legal_reference');
      for (const [field, value] of [['name', p.name], ['summary', p.summary], ['risk_disclosure', p.risk_disclosure], ['revenue_model_description', p.revenue_model_description]]) {
        if (!complete(value)) missing.push(`${field}_all_languages`);
      }
      const [assets] = await tx`select count(*)::int as count from app.investment_product_assets where product_id = ${id}`;
      if (!assets.count) missing.push('assets');
      if (missing.length) throw new AppError('activation_requirements_missing', { status: 422, details: { missing } });
    }
    const [row] = await tx`update app.investment_products set status = ${status} where id = ${id} returning *`;
    await audit(tx, req, { action: 'product.status_changed', entityType: 'investment_product', entityId: id, before: { status: p.status }, after: { status } });
    return productToApi(row);
  });
}

const resultApi = (r) => ({
  ...trimAmounts(camelize(r), ['totalGross', 'totalFee']),
  grossReturnRate: trimAmount(r.gross_return_rate),
});

export async function listResults({ productId }) {
  const rows = await getSql()`
    select r.*, p.slug as product_slug, p.name as product_name, c.email as created_by_email, a.email as approved_by_email
    from app.investment_results r join app.investment_products p on p.id = r.product_id
    join app.profiles c on c.id = r.created_by left join app.profiles a on a.id = r.approved_by
    where (${productId ?? null}::uuid is null or r.product_id = ${productId ?? null})
    order by r.period_start desc limit 200`;
  return rows.map(resultApi);
}

export async function createResult(req, input) {
  return withTransaction(async (tx) => {
    const [asset] = await tx`select 1 from app.investment_product_assets where product_id = ${input.productId} and asset_code = ${input.asset}`;
    if (!asset) throw new AppError('asset_not_supported_by_product', { status: 422 });
    const [row] = await tx`
      insert into app.investment_results (product_id, asset_code, period_start, period_end, gross_return_rate, evidence_reference, notes, status, created_by)
      values (${input.productId}, ${input.asset}, ${input.periodStart}, ${input.periodEnd}, ${input.grossReturnRate}, ${input.evidenceReference},
              ${input.notes ?? null}, 'draft', ${req.auth.userId})
      returning *`;
    await audit(tx, req, { action: 'investment_result.created', entityType: 'investment_result', entityId: row.id, after: input });
    return resultApi(row);
  });
}

async function computeAllocations(tx, resultId) {
  const [result] = await tx`
    select r.*, p.performance_fee_rate, a.decimals
    from app.investment_results r join app.investment_products p on p.id = r.product_id join app.assets a on a.code = r.asset_code
    where r.id = ${resultId}`;
  if (!result) throw new AppError('not_found');
  const positions = await tx`select * from app.result_eligible_positions(${resultId})`;
  const allocations = allocateResult({
    positions,
    periodStart: result.period_start,
    periodEnd: result.period_end,
    grossRate: result.gross_return_rate,
    performanceFeeRate: result.performance_fee_rate,
    decimals: result.decimals,
  });
  return { result, positions, allocations };
}

export async function previewResult(id) {
  return withTransaction(async (tx) => {
    const { result, allocations } = await computeAllocations(tx, id);
    return { result: resultApi(result), allocations };
  });
}

export async function approveResult(req, id) {
  return withTransaction(async (tx) => {
    const [row] = await tx`select * from app.approve_investment_result(${id}, ${req.auth.userId})`;
    await audit(tx, req, { action: 'investment_result.approved', entityType: 'investment_result', entityId: id });
    return resultApi(row);
  });
}

export async function rejectResult(req, id, reason) {
  return withTransaction(async (tx) => {
    const [row] = await tx`
      update app.investment_results set status = 'rejected', rejected_by = ${req.auth.userId}, rejection_reason = ${reason}
      where id = ${id} and status in ('draft', 'approved') returning *`;
    if (!row) throw new AppError('invalid_status_transition');
    await audit(tx, req, { action: 'investment_result.rejected', entityType: 'investment_result', entityId: id, reason });
    return resultApi(row);
  });
}

export async function postResult(req, id) {
  return withTransaction(async (tx) => {
    const { result, allocations } = await computeAllocations(tx, id);
    if (result.status !== 'approved') throw new AppError('result_not_approved', { status: 409 });
    const payload = allocations.map((a) => ({ positionId: a.positionId, gross: a.gross, fee: a.fee, net: a.net }));
    const [row] = await tx`select * from app.post_investment_result(${id}, ${req.auth.userId}, ${tx.json(payload)})`;
    const rewards = await onResultPosted(tx, row, allocations);
    await audit(tx, req, {
      action: 'investment_result.posted',
      entityType: 'investment_result',
      entityId: id,
      after: { positions: allocations.length, totalGross: row.total_gross, totalFee: row.total_fee, referralRewards: rewards.length },
    });
    return { ...resultApi(row), referralRewards: rewards.length };
  });
}
