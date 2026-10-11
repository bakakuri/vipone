// Admin overview. All figures are counted from real records.

import { Router } from 'express';
import { sendData } from '../../../core/respond.js';
import { getSql } from '../../../db/client.js';
import { requirePermission } from '../../../middleware/authenticate.js';
import { camelize, trimAmount } from '../../../utils/camelize.js';

export async function adminDashboard() {
  const sql = getSql();
  const [users, deposits, withdrawals, rewards, ledger, flags, approvals, daily, assets] = await Promise.all([
    sql`
      select count(*)::int as total,
             count(*) filter (where created_at > now() - interval '24 hours')::int as new_24h,
             count(*) filter (where created_at > now() - interval '7 days')::int as new_7d,
             count(*) filter (where kyc_status = 'pending')::int as kyc_pending,
             count(*) filter (where status in ('restricted', 'frozen'))::int as restricted
      from app.profiles`,
    sql`
      select asset_code, count(*)::int as count, sum(amount) as amount from app.deposits
      where status = 'credited' and credited_at > now() - interval '24 hours' group by asset_code`,
    sql`select status, count(*)::int as count, sum(amount) as amount from app.withdrawal_requests where status in ('pending', 'under_review', 'approved', 'processing') or completed_at > now() - interval '24 hours' group by status`,
    sql`select status, asset_code, count(*)::int as count, sum(amount) as amount from app.referral_rewards group by status, asset_code`,
    sql`select count(*)::int as count from app.ledger_transactions where posted_at > now() - interval '24 hours'`,
    sql`select count(*)::int as count from app.risk_flags where status = 'open'`,
    sql`select count(*)::int as count from app.admin_approvals where status = 'pending'`,
    sql`
      with days as (select generate_series(current_date - 13, current_date, interval '1 day')::date as day)
      select d.day,
             (select count(*)::int from app.deposits x where x.status = 'credited' and x.credited_at::date = d.day) as deposits,
             (select count(*)::int from app.withdrawal_requests x where x.status = 'completed' and x.completed_at::date = d.day) as withdrawals,
             (select count(*)::int from app.profiles x where x.created_at::date = d.day) as registrations
      from days d order by d.day`,
    sql`select code from app.assets where is_active order by sort_order`,
  ]);
  const positions = [];
  for (const { code } of assets) {
    const [p] = await sql`select * from app.asset_position(${code})`;
    positions.push({
      asset: code,
      custody: trimAmount(p.custody),
      strategy: trimAmount(p.strategy),
      userLiabilities: trimAmount(p.user_liabilities),
      platformEquity: trimAmount(p.platform_equity),
      coverageRatio: p.coverage_ratio === null ? null : trimAmount(p.coverage_ratio),
    });
  }
  const amt = (rows) => rows.map((r) => ({ ...camelize(r), amount: trimAmount(r.amount) }));
  return {
    users: camelize(users[0]),
    depositsCredited24h: amt(deposits),
    withdrawals: amt(withdrawals),
    referralRewards: amt(rewards),
    ledgerTransactions24h: ledger[0].count,
    openRiskFlags: flags[0].count,
    pendingApprovals: approvals[0].count,
    daily: daily.map((d) => ({ ...camelize(d), day: d.day instanceof Date ? d.day.toISOString().slice(0, 10) : String(d.day) })),
    assets: positions,
  };
}

export function adminDashboardRoutes() {
  const r = Router();
  r.get('/', requirePermission('dashboard.read'), async (req, res) => sendData(res, await adminDashboard()));
  return r;
}
