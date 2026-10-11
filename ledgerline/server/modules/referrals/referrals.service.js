// Referral programme: transparent, platform-funded, duplicate-proof.

import { getConfig } from '../../config/env.js';
import { D } from '../../core/money.js';
import { getSql } from '../../db/client.js';
import { camelize, trimAmount } from '../../utils/camelize.js';
import { pageOf } from '../../utils/schemas.js';
import { getSettings } from '../settings/settings.service.js';
import { calculateReferralReward } from './calculate-referral-reward.js';

async function referralSettings(db) {
  const s = await getSettings(db, ['referral.enabled', 'referral.deposit_rate', 'referral.deposit_scope', 'referral.profit_rate']);
  return {
    enabled: s['referral.enabled'] !== false,
    depositRate: s['referral.deposit_rate'] || '0',
    depositScope: s['referral.deposit_scope'] || 'all_deposits',
    profitRate: s['referral.profit_rate'] || '0',
  };
}

// Called in the same transaction that credits a deposit.
export async function onDepositCredited(tx, deposit) {
  const settings = await referralSettings(tx);
  if (!settings.enabled) return null;
  const [rel] = await tx`select referrer_user_id from app.referral_relationships where referred_user_id = ${deposit.user_id}`;
  if (!rel) return null;
  if (settings.depositScope === 'first_deposit') {
    const [earlier] = await tx`
      select 1 from app.deposits where user_id = ${deposit.user_id} and status = 'credited' and id <> ${deposit.id} limit 1`;
    if (earlier) return null;
  }
  const [asset] = await tx`select decimals from app.assets where code = ${deposit.asset_code}`;
  const amount = calculateReferralReward({ baseAmount: deposit.amount, rate: settings.depositRate, decimals: asset.decimals });
  if (!amount) return null;
  const [reward] = await tx`
    select * from app.create_referral_reward(${deposit.user_id}, 'deposit', ${deposit.id}, ${deposit.asset_code},
                                            ${deposit.amount}, ${settings.depositRate}, ${amount})`;
  return reward?.id ? reward : null;
}

// Called in the same transaction that posts a realised investment result.
// Rewards are based on each referred user's NET realised profit only.
export async function onResultPosted(tx, result, allocations) {
  const settings = await referralSettings(tx);
  if (!settings.enabled) return [];
  const [asset] = await tx`select decimals from app.assets where code = ${result.asset_code}`;
  const netByUser = new Map();
  for (const a of allocations) {
    const current = netByUser.get(a.userId) || [];
    current.push(a.net);
    netByUser.set(a.userId, current);
  }
  const created = [];
  for (const [userId, nets] of netByUser) {
    const total = nets.reduce((acc, n) => acc.plus(n), new D(0));
    if (total.lte(0)) continue;
    const amount = calculateReferralReward({ baseAmount: total.toFixed(), rate: settings.profitRate, decimals: asset.decimals });
    if (!amount) continue;
    const [reward] = await tx`
      select * from app.create_referral_reward(${userId}, 'investment_result', ${result.id}, ${result.asset_code},
                                              ${total.toFixed()}, ${settings.profitRate}, ${amount})`;
    if (reward?.id) created.push(reward);
  }
  return created;
}

export async function getOverview(userId) {
  const sql = getSql();
  const config = getConfig();
  const [code] = await sql`select code from app.referral_codes where user_id = ${userId}`;
  const [counts] = await sql`
    select count(*)::int as invited,
           count(*) filter (where exists (select 1 from app.deposits d where d.user_id = r.referred_user_id and d.status = 'credited'))::int as funded
    from app.referral_relationships r where r.referrer_user_id = ${userId}`;
  const totals = await sql`
    select asset_code, status, sum(amount) as amount, count(*)::int as count
    from app.referral_rewards where referrer_id = ${userId}
    group by asset_code, status order by asset_code`;
  const deposits = await sql`
    select d.asset_code, sum(d.amount) as amount, count(*)::int as count
    from app.deposits d join app.referral_relationships r on r.referred_user_id = d.user_id
    where r.referrer_user_id = ${userId} and d.status = 'credited'
    group by d.asset_code`;
  const settings = await referralSettings(sql);
  return {
    code: code?.code ?? null,
    link: code ? `${config.appUrl}/register?ref=${code.code}` : null,
    invited: counts.invited,
    fundedReferrals: counts.funded,
    confirmedDeposits: deposits.map((d) => ({ asset: d.asset_code, amount: trimAmount(d.amount), count: d.count })),
    rewards: totals.map((t) => ({ asset: t.asset_code, status: t.status, amount: trimAmount(t.amount), count: t.count })),
    programme: {
      enabled: settings.enabled,
      depositRate: settings.depositRate,
      depositScope: settings.depositScope,
      profitRate: settings.profitRate,
    },
  };
}

export async function listRewards(userId, { status, limit, cursor }) {
  const sql = getSql();
  const rows = await sql`
    select rr.id, rr.source_type, rr.asset_code, rr.base_amount, rr.rate, rr.amount, rr.status, rr.status_reason,
           rr.release_at, rr.credited_at, rr.created_at, rr.ledger_transaction_id,
           left(p.email, 2) || '***@' || split_part(p.email, '@', 2) as referred_email_masked
    from app.referral_rewards rr
    join app.profiles p on p.id = rr.referred_id
    where rr.referrer_id = ${userId}
      and (${status ?? null}::text is null or rr.status = ${status ?? null})
      and (${cursor?.t ?? null}::timestamptz is null or (rr.created_at, rr.id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by rr.created_at desc, rr.id desc
    limit ${limit + 1}`;
  const page = pageOf(rows, limit);
  return {
    items: page.items.map((r) => ({
      ...camelize(r),
      baseAmount: trimAmount(r.base_amount),
      amount: trimAmount(r.amount),
      rate: trimAmount(r.rate),
    })),
    nextCursor: page.nextCursor,
  };
}
