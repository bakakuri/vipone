// Earnings = realised investment results (posted, confirmed) and referral
// rewards (pending until credited). Nothing estimated is ever shown as earned.

import { getSql } from '../../db/client.js';
import { camelize, trimAmount } from '../../utils/camelize.js';
import { pageOf } from '../../utils/schemas.js';
import { getUserBalances } from '../ledger/ledger.repository.js';

export async function listEarnings(userId, { kind, asset, limit, cursor }) {
  const rows = await getSql()`
    with items as (
      select 'result-' || e.id as id, case when e.net_amount >= 0 then 'profit' else 'loss' end as kind,
             p.asset_code, e.net_amount as amount, e.gross_amount, e.fee_amount, 'confirmed' as status,
             e.created_at, p.reference as position_reference, p.id as position_id,
             r.period_start, r.period_end, e.ledger_transaction_id, null::timestamptz as release_at
      from app.investment_events e
      join app.investment_positions p on p.id = e.position_id
      join app.investment_results r on r.id = e.result_id
      where p.user_id = ${userId} and e.event_type = 'result'
      union all
      select 'referral-' || rr.id, 'referral_reward', rr.asset_code, rr.amount, rr.base_amount, null,
             case rr.status when 'credited' then 'confirmed' when 'cancelled' then 'cancelled' else 'pending' end,
             rr.created_at, null, null, null, null, rr.ledger_transaction_id, rr.release_at
      from app.referral_rewards rr where rr.referrer_id = ${userId}
    )
    select * from items
    where (${kind ?? null}::text is null or kind = ${kind ?? null})
      and (${asset ?? null}::text is null or asset_code = ${asset ?? null})
      and (${cursor?.t ?? null}::timestamptz is null or (created_at, id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::text))
    order by created_at desc, id desc
    limit ${limit + 1}`;
  const page = pageOf(rows, limit);
  return {
    items: page.items.map((r) => ({
      ...camelize(r),
      asset: r.asset_code,
      amount: trimAmount(r.amount),
      grossAmount: trimAmount(r.gross_amount),
      feeAmount: trimAmount(r.fee_amount),
    })),
    nextCursor: page.nextCursor,
  };
}

export async function earningsSummary(userId) {
  const sql = getSql();
  const results = await sql`
    select p.asset_code,
           coalesce(sum(e.net_amount) filter (where e.net_amount > 0), 0) as realised_profit,
           coalesce(sum(e.net_amount) filter (where e.net_amount < 0), 0) as realised_loss,
           coalesce(sum(e.net_amount), 0) as realised_net,
           coalesce(sum(e.fee_amount), 0) as fees
    from app.investment_events e join app.investment_positions p on p.id = e.position_id
    where p.user_id = ${userId} and e.event_type = 'result'
    group by p.asset_code`;
  const referrals = await sql`
    select asset_code,
           coalesce(sum(amount) filter (where status = 'credited'), 0) as credited,
           coalesce(sum(amount) filter (where status in ('pending', 'under_review')), 0) as pending
    from app.referral_rewards where referrer_id = ${userId} group by asset_code`;
  const [awaiting] = await sql`
    select count(*)::int as count from app.investment_positions where user_id = ${userId} and status = 'awaiting_settlement'`;
  const balances = await getUserBalances(sql, userId);
  const assets = new Set([...results.map((r) => r.asset_code), ...referrals.map((r) => r.asset_code)]);
  for (const b of balances) if (b.total !== '0') assets.add(b.asset);
  return {
    awaitingSettlement: awaiting.count,
    perAsset: [...assets].sort().map((asset) => {
      const r = results.find((x) => x.asset_code === asset);
      const rf = referrals.find((x) => x.asset_code === asset);
      const b = balances.find((x) => x.asset === asset);
      return {
        asset,
        realisedProfit: trimAmount(r?.realised_profit ?? '0'),
        realisedLoss: trimAmount(r?.realised_loss ?? '0'),
        realisedNet: trimAmount(r?.realised_net ?? '0'),
        performanceFees: trimAmount(r?.fees ?? '0'),
        referralCredited: trimAmount(rf?.credited ?? '0'),
        referralPending: trimAmount(rf?.pending ?? '0'),
        withdrawable: b?.withdrawable ?? '0',
        depositHold: b?.depositHold ?? '0',
        withdrawalHold: b?.withdrawalHold ?? '0',
        invested: b?.invested ?? '0',
      };
    }),
  };
}
