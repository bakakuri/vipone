// Investment products, positions, results — read queries.

import { camelize, trimAmount, trimAmounts } from '../../utils/camelize.js';

const PRODUCT_AMOUNTS = ['minAmount', 'maxAmount', 'capacity', 'performanceFeeRate', 'earlyExitFeeRate', 'allocated'];

export function productToApi(row) {
  const p = trimAmounts(camelize(row), PRODUCT_AMOUNTS);
  delete p.createdBy;
  return p;
}

export async function listProducts(db, { statuses = ['active', 'paused'], slug } = {}) {
  const rows = await db`
    select p.id, p.slug, p.name, p.summary, p.risk_disclosure, p.revenue_model, p.revenue_model_description, p.term_days,
           p.min_amount, p.max_amount, p.capacity, p.performance_fee_rate, p.early_exit_allowed, p.early_exit_fee_rate,
           p.risk_level, p.status, p.version, p.results_through, p.legal_status, p.legal_reference,
           coalesce((select array_agg(asset_code order by asset_code) from app.investment_product_assets where product_id = p.id), '{}') as assets,
           coalesce((select sum(principal) from app.investment_positions where product_id = p.id and status in ('active', 'awaiting_settlement')), 0) as allocated
    from app.investment_products p
    where p.status in ${db(statuses)} and (${slug ?? null}::text is null or p.slug = ${slug ?? null})
    order by p.created_at`;
  return rows.map(productToApi);
}

// Realised, posted results only — the platform shows history, never projections.
export async function productResults(db, productId, limit = 24) {
  const rows = await db`
    select id, asset_code, period_start, period_end, gross_return_rate, posted_at
    from app.investment_results where product_id = ${productId} and status = 'posted'
    order by period_start desc limit ${limit}`;
  return rows.map((r) => ({ ...camelize(r), grossReturnRate: trimAmount(r.gross_return_rate) }));
}

export async function listPositions(db, userId, { status } = {}) {
  const rows = await db`
    select pos.id, pos.reference, pos.product_id, pr.slug as product_slug, pr.name as product_name, pos.product_version,
           pos.asset_code, pos.principal, pos.status, pos.started_at, pos.maturity_at, pos.closed_at, pos.released_amount,
           pos.early_exit_fee, pr.early_exit_allowed, pr.results_through,
           coalesce((select sum(e.net_amount) from app.investment_events e where e.position_id = pos.id and e.event_type = 'result'), 0) as realised_result,
           app.position_value(pos.id) as current_value,
           (select max(r.period_end) from app.investment_events e join app.investment_results r on r.id = e.result_id
             where e.position_id = pos.id and e.event_type = 'result') as last_result_at
    from app.investment_positions pos
    join app.investment_products pr on pr.id = pos.product_id
    where pos.user_id = ${userId} and (${status ?? null}::text is null or pos.status = ${status ?? null})
    order by pos.created_at desc
    limit 200`;
  return rows.map((r) => trimAmounts(camelize(r), ['principal', 'releasedAmount', 'earlyExitFee', 'realisedResult', 'currentValue']));
}

export async function getPosition(db, userId, id) {
  const [row] = await db`
    select pos.*, pr.slug as product_slug, pr.name as product_name, v.terms
    from app.investment_positions pos
    join app.investment_products pr on pr.id = pos.product_id
    join app.investment_product_versions v on v.product_id = pos.product_id and v.version = pos.product_version
    where pos.id = ${id} and pos.user_id = ${userId}`;
  if (!row) return null;
  const events = await db`
    select e.event_type, e.gross_amount, e.fee_amount, e.net_amount, e.created_at, e.ledger_transaction_id,
           r.period_start, r.period_end, r.gross_return_rate
    from app.investment_events e left join app.investment_results r on r.id = e.result_id
    where e.position_id = ${id} order by e.created_at, e.id`;
  const [value] = await db`select app.position_value(${id}) as value`;
  const out = trimAmounts(camelize(row), ['principal', 'releasedAmount', 'earlyExitFee']);
  delete out.userId;
  delete out.idempotencyKey;
  out.currentValue = trimAmount(value.value);
  out.events = events.map((e) => trimAmounts(camelize(e), ['grossAmount', 'feeAmount', 'netAmount', 'grossReturnRate']));
  return out;
}
