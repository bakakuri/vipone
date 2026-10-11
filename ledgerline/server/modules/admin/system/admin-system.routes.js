// System health for administrators: database, ledger integrity, jobs,
// outbound email, approvals, unprocessed chain events, address pools.

import { Router } from 'express';
import { getConfig } from '../../../config/env.js';
import { sendData } from '../../../core/respond.js';
import { getSql } from '../../../db/client.js';
import { requirePermission } from '../../../middleware/authenticate.js';
import { camelize } from '../../../utils/camelize.js';

export async function systemHealth() {
  const sql = getSql();
  const config = getConfig();
  const started = Date.now();
  await sql`select 1`;
  const dbLatencyMs = Date.now() - started;
  const [integrity, jobs, outbox, approvals, flags, events, pools] = await Promise.all([
    sql`select count(*)::int as issues from app.verify_ledger_integrity()`,
    sql`
      select distinct on (job_name) job_name, status, error, started_at, finished_at, result
      from app.job_runs order by job_name, started_at desc`,
    sql`select status, count(*)::int as count from app.email_outbox where status in ('queued', 'failed', 'sending') group by status`,
    sql`select count(*)::int as count from app.admin_approvals where status = 'pending'`,
    sql`select count(*)::int as count from app.risk_flags where status = 'open'`,
    sql`
      select processing_result, count(*)::int as count from app.blockchain_events
      where received_at > now() - interval '7 days' and (processing_result in ('unknown_address', 'unknown_asset', 'unknown_withdrawal', 'amount_mismatch') or processed_at is null)
      group by processing_result`,
    sql`
      select n.code as network, n.is_active,
             (select count(*)::int from app.deposit_address_pool p where p.network_code = n.code and p.status = 'available') as available
      from app.networks n order by n.code`,
  ]);
  return {
    mode: config.mode,
    providers: {
      auth: config.auth.provider,
      email: config.email.provider,
      screening: config.screening.provider,
      kyc: config.kyc.provider,
      prices: config.prices.provider,
      live: config.live.transport,
      rateLimit: config.rateLimitStore,
    },
    database: { ok: true, latencyMs: dbLatencyMs },
    ledgerIntegrityIssues: integrity[0].issues,
    jobs: jobs.map(camelize),
    emailOutbox: Object.fromEntries(outbox.map((o) => [o.status, o.count])),
    pendingApprovals: approvals[0].count,
    openRiskFlags: flags[0].count,
    chainEventIssues: events.map(camelize),
    addressPools: pools.map(camelize),
  };
}

export function adminSystemRoutes() {
  const r = Router();
  r.get('/health', requirePermission('dashboard.read'), async (req, res) => sendData(res, await systemHealth()));
  return r;
}
