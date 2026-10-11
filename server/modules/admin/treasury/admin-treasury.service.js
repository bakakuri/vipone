// Treasury: per-asset solvency (custody + strategy vs. user balances),
// reconciliation against observed balances, custody <-> strategy transfers,
// operator capital contributions, and ledger integrity verification.

import { getSql, withTransaction } from '../../../db/client.js';
import { camelize, trimAmount, trimAmounts } from '../../../utils/camelize.js';
import { audit } from '../../audit/audit.service.js';

const POSITION_AMOUNTS = ['custody', 'strategy', 'userLiabilities', 'suspense', 'platformEquity'];

export async function overview() {
  const sql = getSql();
  const assets = await sql`select code from app.assets where is_active order by sort_order`;
  const positions = [];
  for (const { code } of assets) {
    const [p] = await sql`select * from app.asset_position(${code})`;
    const [last] = await sql`
      select id, status, observed_custody, observed_strategy, custody_difference, strategy_difference, coverage_ratio, created_at
      from app.reconciliation_runs where asset_code = ${code} order by created_at desc limit 1`;
    positions.push({
      ...trimAmounts(camelize(p), POSITION_AMOUNTS),
      coverageRatio: p.coverage_ratio === null ? null : trimAmount(p.coverage_ratio),
      lastReconciliation: last ? trimAmounts(camelize(last), ['observedCustody', 'observedStrategy', 'custodyDifference', 'strategyDifference', 'coverageRatio']) : null,
    });
  }
  const [paused] = await sql`select value from app.system_settings where key = 'withdrawals.paused_assets'`;
  return { positions, pausedAssets: paused?.value ?? [] };
}

export async function reconciliations(asset) {
  const rows = await getSql()`
    select r.*, p.email as created_by_email from app.reconciliation_runs r left join app.profiles p on p.id = r.created_by
    where (${asset ?? null}::text is null or r.asset_code = ${asset ?? null}) order by r.created_at desc limit 100`;
  return rows.map((r) => trimAmounts(camelize(r), ['observedCustody', 'observedStrategy', 'ledgerCustody', 'ledgerStrategy', 'userLiabilities', 'suspense', 'custodyDifference', 'strategyDifference', 'coverageRatio', 'tolerance']));
}

export async function reconcile(req, { asset, observedCustody, observedStrategy, evidence, notes }) {
  return withTransaction(async (tx) => {
    const [row] = await tx`select * from app.run_reconciliation(${asset}, ${observedCustody}, ${observedStrategy}, ${evidence}, ${notes ?? null}, ${req.auth.userId})`;
    await audit(tx, req, { action: 'treasury.reconciled', entityType: 'asset', entityId: asset, after: { status: row.status, runId: row.id } });
    return camelize(row);
  });
}

export async function transfer(req, input, idempotencyKey) {
  return withTransaction(async (tx) => {
    const [row] = await tx`
      select * from app.treasury_transfer(${input.asset}, ${input.from}, ${input.to}, ${input.amount}, ${input.evidence}, ${req.auth.userId}, ${idempotencyKey})`;
    await audit(tx, req, { action: 'treasury.transfer', entityType: 'asset', entityId: input.asset, after: input });
    return trimAmounts(camelize(row), ['amount']);
  });
}

export async function capital(req, input, idempotencyKey) {
  return withTransaction(async (tx) => {
    const [row] = await tx`select * from app.record_capital_contribution(${input.asset}, ${input.amount}, ${input.evidence}, ${req.auth.userId}, ${idempotencyKey})`;
    await audit(tx, req, { action: 'treasury.capital_contribution', entityType: 'asset', entityId: input.asset, after: input });
    return trimAmounts(camelize(row), ['amount']);
  });
}

export async function integrity() {
  const rows = await getSql()`select * from app.verify_ledger_integrity()`;
  return { ok: rows.length === 0, issues: rows.map((r) => ({ ...camelize(r), expected: trimAmount(r.expected), actual: trimAmount(r.actual) })) };
}
