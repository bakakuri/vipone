import { AppError } from '../../../core/errors.js';
import { getSql, withTransaction } from '../../../db/client.js';
import { camelize, trimAmounts } from '../../../utils/camelize.js';
import { pageOf } from '../../../utils/schemas.js';
import { audit } from '../../audit/audit.service.js';

export async function listRewards({ status, search, limit, cursor }) {
  const rows = await getSql()`
    select rr.*, a.email as referrer_email, b.email as referred_email,
           exists (select 1 from app.risk_flags f where f.status = 'open' and f.user_id in (rr.referrer_id, rr.referred_id)) as has_open_flags
    from app.referral_rewards rr
    join app.profiles a on a.id = rr.referrer_id
    join app.profiles b on b.id = rr.referred_id
    where (${status ?? null}::text is null or rr.status = ${status ?? null})
      and (${search ?? null}::text is null or lower(a.email) = lower(${search ?? ''}) or lower(b.email) = lower(${search ?? ''}))
      and (${cursor?.t ?? null}::timestamptz is null or (rr.created_at, rr.id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by rr.created_at desc, rr.id desc limit ${limit + 1}`;
  const page = pageOf(rows, limit);
  return { items: page.items.map((r) => trimAmounts(camelize(r), ['baseAmount', 'rate', 'amount'])), nextCursor: page.nextCursor };
}

export async function listRelationships({ search, limit }) {
  const rows = await getSql()`
    select r.referred_user_id, b.email as referred_email, r.referrer_user_id, a.email as referrer_email, r.code, r.created_at,
           (select count(*)::int from app.deposits d where d.user_id = r.referred_user_id and d.status = 'credited') as credited_deposits
    from app.referral_relationships r
    join app.profiles a on a.id = r.referrer_user_id
    join app.profiles b on b.id = r.referred_user_id
    where (${search ?? null}::text is null or lower(a.email) = lower(${search ?? ''}) or lower(b.email) = lower(${search ?? ''}) or r.code = upper(${search ?? ''}))
    order by r.created_at desc limit ${limit}`;
  return rows.map(camelize);
}

// Detects patterns worth a look: many referrals from one signup network,
// referred users withdrawing to their referrer's address, reward bursts.
export async function suspicious() {
  const sql = getSql();
  const sharedIp = await sql`
    select f.user_id, p.email, f.flag_type, f.created_at from app.risk_flags f join app.profiles p on p.id = f.user_id
    where f.status = 'open' and f.flag_type in ('shared_signup_ip_with_referrer', 'shared_wallet_with_referrer')
    order by f.created_at desc limit 100`;
  const bursts = await sql`
    select r.referrer_user_id, p.email, count(*)::int as referrals_24h
    from app.referral_relationships r join app.profiles p on p.id = r.referrer_user_id
    where r.created_at > now() - interval '24 hours'
    group by r.referrer_user_id, p.email having count(*) >= 10 order by count(*) desc`;
  return { flags: sharedIp.map(camelize), bursts: bursts.map(camelize) };
}

export async function reviewReward(req, id, { decision, reason }) {
  return withTransaction(async (tx) => {
    const [row] = await tx`select * from app.review_referral_reward(${id}, ${decision}, ${req.auth.userId}, ${reason})`;
    if (!row) throw new AppError('not_found');
    await audit(tx, req, { action: `referral_reward.${decision}`, entityType: 'referral_reward', entityId: id, after: { status: row.status }, reason });
    return trimAmounts(camelize(row), ['baseAmount', 'rate', 'amount']);
  });
}
