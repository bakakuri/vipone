// User administration: search, full account view, restrictions, KYC
// decisions, staff roles (through approvals) and risk flags.

import { AppError } from '../../../core/errors.js';
import { getSql, withTransaction } from '../../../db/client.js';
import { camelize, trimAmount } from '../../../utils/camelize.js';
import { pageOf } from '../../../utils/schemas.js';
import { audit } from '../../audit/audit.service.js';
import { getUserBalances } from '../../ledger/ledger.repository.js';
import { createApproval } from '../approvals/admin-approvals.service.js';

export async function listUsers({ search, status, kyc, staff, limit, cursor }) {
  const term = search ? `%${search.toLowerCase()}%` : null;
  const rows = await getSql()`
    select p.id, p.email, p.display_name, p.status, p.kyc_status, p.mfa_enabled, p.country_code, p.created_at, p.last_login_at,
           coalesce((select array_agg(role) from app.user_roles r where r.user_id = p.id), '{}') as roles,
           (select count(*)::int from app.risk_flags f where f.user_id = p.id and f.status = 'open') as open_flags
    from app.profiles p
    where (${term}::text is null or lower(p.email) like ${term} or p.id::text = ${search ?? ''}
           or exists (select 1 from app.referral_codes c where c.user_id = p.id and c.code = upper(${search ?? ''})))
      and (${status ?? null}::text is null or p.status = ${status ?? null})
      and (${kyc ?? null}::text is null or p.kyc_status = ${kyc ?? null})
      and (${staff ? true : null}::boolean is null or exists (select 1 from app.user_roles r where r.user_id = p.id))
      and (${cursor?.t ?? null}::timestamptz is null or (p.created_at, p.id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by p.created_at desc, p.id desc
    limit ${limit + 1}`;
  const page = pageOf(rows, limit);
  return { items: page.items.map(camelize), nextCursor: page.nextCursor };
}

export async function getUser(id) {
  const sql = getSql();
  const [profile] = await sql`
    select p.*, coalesce((select array_agg(role) from app.user_roles r where r.user_id = p.id), '{}') as roles,
           c.code as referral_code
    from app.profiles p left join app.referral_codes c on c.user_id = p.id where p.id = ${id}`;
  if (!profile) throw new AppError('not_found');
  const [deposits, withdrawals, positions, referral, flags, kyc, events, wallets] = await Promise.all([
    sql`select id, reference, asset_code, network_code, amount, status, status_reason, tx_hash, created_at from app.deposits where user_id = ${id} order by created_at desc limit 20`,
    sql`select id, reference, asset_code, network_code, amount, net_amount, status, tx_hash, created_at from app.withdrawal_requests where user_id = ${id} order by created_at desc limit 20`,
    sql`select id, reference, asset_code, principal, status, started_at, maturity_at, app.position_value(id) as current_value from app.investment_positions where user_id = ${id} order by created_at desc limit 20`,
    sql`
      select (select referrer_user_id from app.referral_relationships where referred_user_id = ${id}) as referrer_id,
             (select p2.email from app.referral_relationships r join app.profiles p2 on p2.id = r.referrer_user_id where r.referred_user_id = ${id}) as referrer_email,
             (select count(*)::int from app.referral_relationships where referrer_user_id = ${id}) as referred_count`,
    sql`select id, flag_type, severity, details, status, created_at, resolved_at, resolution_note from app.risk_flags where user_id = ${id} order by created_at desc limit 50`,
    sql`select id, provider, provider_reference, level, status, reason, created_at, updated_at from app.kyc_verifications where user_id = ${id} order by created_at desc`,
    sql`select event_type, user_agent, metadata, created_at from app.security_events where user_id = ${id} order by created_at desc limit 30`,
    sql`select id, label, asset_code, network_code, address, memo, status, is_default, usable_from, created_at from app.withdrawal_wallets where user_id = ${id} order by created_at desc`,
  ]);
  const amount = (rows, keys) => rows.map((r) => {
    const o = camelize(r);
    for (const k of keys) o[k] = trimAmount(o[k]);
    return o;
  });
  const out = camelize(profile);
  delete out.signupIpHash;
  return {
    profile: out,
    balances: await getUserBalances(sql, id),
    deposits: amount(deposits, ['amount']),
    withdrawals: amount(withdrawals, ['amount', 'netAmount']),
    positions: amount(positions, ['principal', 'currentValue']),
    referral: camelize(referral[0]),
    riskFlags: flags.map(camelize),
    kyc: kyc.map(camelize),
    securityEvents: events.map(camelize),
    wallets: wallets.map(camelize),
  };
}

export async function setStatus(req, id, { status, reason }) {
  return withTransaction(async (tx) => {
    const [user] = await tx`select id, status from app.profiles where id = ${id} for update`;
    if (!user) throw new AppError('not_found');
    if (user.status === status) throw new AppError('no_change', { status: 409 });
    if (id === req.auth.userId) throw new AppError('cannot_change_own_status', { status: 403 });
    if (status === 'active') {
      // Lifting a restriction is a relaxation: second approver required.
      const approval = await createApproval(tx, req, { actionType: 'user.reinstate', payload: { userId: id }, reason });
      return { applied: false, approval };
    }
    await tx`update app.profiles set status = ${status}, status_reason = ${reason} where id = ${id}`;
    await tx`select app.notify(${id}, 'security_alert', ${tx.json({ kind: 'account_' + status })}, '/support')`;
    await audit(tx, req, { action: 'user.status_changed', entityType: 'profile', entityId: id, before: { status: user.status }, after: { status }, reason });
    return { applied: true, status };
  });
}

export async function decideKyc(req, id, { status, reason }) {
  return withTransaction(async (tx) => {
    const [user] = await tx`select id, kyc_status from app.profiles where id = ${id} for update`;
    if (!user) throw new AppError('not_found');
    await tx`
      insert into app.kyc_verifications (user_id, provider, provider_reference, status, reason, reviewed_by)
      values (${id}, 'manual', ${`manual:${id}:${Date.now()}`}, ${status}, ${reason ?? null}, ${req.auth.userId})`;
    await tx`update app.profiles set kyc_status = ${status} where id = ${id}`;
    await tx`select app.notify(${id}, 'kyc_updated', ${tx.json({ status })}, '/profile')`;
    await audit(tx, req, { action: 'kyc.decided', entityType: 'profile', entityId: id, before: { kycStatus: user.kyc_status }, after: { kycStatus: status }, reason });
    return { kycStatus: status };
  });
}

export async function requestRoleChange(req, id, { role, action, reason }) {
  return withTransaction(async (tx) => {
    const [user] = await tx`select id, mfa_enabled from app.profiles where id = ${id}`;
    if (!user) throw new AppError('not_found');
    return createApproval(tx, req, { actionType: action === 'grant' ? 'role.grant' : 'role.revoke', payload: { userId: id, role }, reason });
  });
}

export async function listRiskFlags({ status, limit, cursor }) {
  const rows = await getSql()`
    select f.*, p.email from app.risk_flags f join app.profiles p on p.id = f.user_id
    where (${status ?? null}::text is null or f.status = ${status ?? null})
      and (${cursor?.t ?? null}::timestamptz is null or (f.created_at, f.id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by f.created_at desc, f.id desc limit ${limit + 1}`;
  const page = pageOf(rows, limit);
  return { items: page.items.map(camelize), nextCursor: page.nextCursor };
}

export async function resolveRiskFlag(req, id, { resolution, note }) {
  return withTransaction(async (tx) => {
    const [row] = await tx`
      update app.risk_flags set status = ${resolution}, resolved_by = ${req.auth.userId}, resolved_at = now(), resolution_note = ${note}
      where id = ${id} and status = 'open' returning *`;
    if (!row) throw new AppError('not_found');
    await audit(tx, req, { action: 'risk_flag.resolved', entityType: 'risk_flag', entityId: id, after: { status: resolution }, reason: note });
    return camelize(row);
  });
}
