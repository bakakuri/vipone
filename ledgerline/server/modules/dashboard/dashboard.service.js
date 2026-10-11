// Dashboard summary: one request, every figure computed by the database from
// the ledger and domain tables. The browser only formats what it receives.

import { getConfig } from '../../config/env.js';
import { dec, toAmountString } from '../../core/money.js';
import { getSql } from '../../db/client.js';
import { camelize, trimAmount } from '../../utils/camelize.js';
import { getActiveHolds, getUserBalances, userBalanceHistory } from '../ledger/ledger.repository.js';
import { listActivity } from '../transactions/transactions.repository.js';
import { calculateInvestmentPeriod } from '../investments/calculate-investment-period.js';

async function valuation(sql, balances) {
  const prices = await sql`
    select distinct on (asset_code) asset_code, price, captured_at
    from app.asset_prices where quote_currency = 'USD' order by asset_code, captured_at desc`;
  let total = dec(0);
  let pricedAt = null;
  const missing = [];
  for (const b of balances) {
    if (b.total === '0') continue;
    const p = prices.find((x) => x.asset_code === b.asset);
    if (!p) {
      missing.push(b.asset);
      continue;
    }
    total = total.plus(dec(b.total).mul(p.price));
    if (!pricedAt || p.captured_at < pricedAt) pricedAt = p.captured_at;
  }
  return { currency: 'USD', total: toAmountString(total.toDecimalPlaces(2)), approximate: true, pricedAt, missingPrices: missing };
}

export async function getDashboard(userId) {
  const sql = getSql();
  const balances = await getUserBalances(sql, userId);
  const [positions, recent, unread, latestNotifications, referral, withdrawals, deposits, holds] = await Promise.all([
    sql`
      select p.id, p.reference, p.asset_code, p.principal, p.status, p.started_at, p.maturity_at, pr.name as product_name,
             app.position_value(p.id) as current_value
      from app.investment_positions p join app.investment_products pr on pr.id = p.product_id
      where p.user_id = ${userId} and p.status in ('active', 'awaiting_settlement')
      order by p.maturity_at limit 20`,
    listActivity(sql, userId, { limit: 8 }),
    sql`select count(*)::int as count from app.notifications where user_id = ${userId} and read_at is null`,
    sql`select id, type, params, link, read_at, created_at from app.notifications where user_id = ${userId} order by created_at desc limit 5`,
    sql`
      select (select count(*)::int from app.referral_relationships where referrer_user_id = ${userId}) as invited,
             coalesce((select jsonb_agg(jsonb_build_object('asset', asset_code, 'status', status, 'amount', amount::text))
                       from (select asset_code, status, sum(amount) as amount from app.referral_rewards
                             where referrer_id = ${userId} and status in ('pending', 'under_review', 'credited')
                             group by asset_code, status) s), '[]'::jsonb) as rewards`,
    sql`
      select id, reference, asset_code, net_amount, amount, status, created_at from app.withdrawal_requests
      where user_id = ${userId} and status in ('pending', 'under_review', 'approved', 'processing')
      order by created_at desc limit 10`,
    sql`
      select id, reference, asset_code, network_code, amount, expected_amount, status, confirmations, required_confirmations, created_at
      from app.deposits where user_id = ${userId} and status in ('awaiting_payment', 'detected', 'confirming', 'confirmed', 'under_review')
      order by created_at desc limit 10`,
    getActiveHolds(sql, userId),
  ]);

  const now = new Date();
  return {
    mode: getConfig().mode,
    balances,
    valuation: await valuation(sql, balances),
    positions: positions.map((p) => ({
      ...camelize(p),
      principal: trimAmount(p.principal),
      currentValue: trimAmount(p.current_value),
      period: calculateInvestmentPeriod({ startedAt: p.started_at, maturityAt: p.maturity_at, now }),
    })),
    recentTransactions: recent.slice(0, 8).map((r) => ({ ...camelize(r), asset: r.asset_code, amount: trimAmount(r.amount) })),
    notifications: { unread: unread[0].count, latest: latestNotifications.map(camelize) },
    referrals: {
      invited: referral[0].invited,
      rewards: referral[0].rewards.map((r) => ({ ...r, amount: trimAmount(r.amount) })),
    },
    openWithdrawals: withdrawals.map((w) => ({ ...camelize(w), amount: trimAmount(w.amount), netAmount: trimAmount(w.net_amount) })),
    openDeposits: deposits.map((d) => ({ ...camelize(d), amount: trimAmount(d.amount), expectedAmount: trimAmount(d.expected_amount) })),
    holds: holds.map((h) => ({ asset: h.asset_code, amount: trimAmount(h.amount), unlockAt: h.unlock_at })),
  };
}

export async function getHistory(userId, { asset, days }) {
  const rows = await userBalanceHistory(getSql(), userId, asset, days);
  return { asset, points: rows.map((r) => ({ day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day), balance: trimAmount(r.balance) })) };
}
