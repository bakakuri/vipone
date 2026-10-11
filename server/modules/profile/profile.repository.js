// Data access for profiles. Every query is scoped by the user id it is given.

export async function getAuthProfile(db, userId) {
  const [row] = await db`
    select p.id, p.email, p.display_name, p.locale, p.theme, p.country_code, p.status, p.status_reason,
           p.kyc_status, p.mfa_enabled, p.onboarding, p.created_at,
           coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}') as roles
    from app.profiles p
    left join app.user_roles r on r.user_id = p.id
    where p.id = ${userId}
    group by p.id`;
  return row || null;
}

export async function createProfile(db, { id, email, locale, countryCode, signupIpHash }) {
  const [row] = await db`
    insert into app.profiles (id, email, locale, country_code, signup_ip_hash)
    values (${id}, ${email}, ${locale}, ${countryCode}, ${signupIpHash})
    on conflict (id) do nothing
    returning *`;
  return row;
}

export async function updatePreferences(db, userId, { locale, theme, displayName }) {
  const [row] = await db`
    update app.profiles set
      locale = coalesce(${locale ?? null}, locale),
      theme = coalesce(${theme ?? null}, theme),
      display_name = case when ${displayName === undefined} then display_name else ${displayName ?? null} end
    where id = ${userId}
    returning id, email, display_name, locale, theme`;
  return row;
}

export async function updateOnboarding(db, userId, onboarding) {
  const [row] = await db`
    update app.profiles set onboarding = ${db.json(onboarding)} where id = ${userId} returning onboarding`;
  return row?.onboarding;
}

export async function setMfaEnabled(db, userId, enabled) {
  await db`update app.profiles set mfa_enabled = ${enabled} where id = ${userId}`;
}

export async function touchLogin(db, userId) {
  await db`update app.profiles set last_login_at = now() where id = ${userId}`;
}

export async function recordSecurityEvent(db, { userId, type, ipHash, userAgent, metadata }) {
  await db`
    insert into app.security_events (user_id, event_type, ip_hash, user_agent, metadata)
    values (${userId}, ${type}, ${ipHash}, ${userAgent}, ${db.json(metadata || {})})`;
}

export async function listSecurityEvents(db, userId, limit = 20) {
  return db`
    select event_type, user_agent, metadata, created_at from app.security_events
    where user_id = ${userId} order by created_at desc limit ${limit}`;
}

export async function hasSeenIpHash(db, userId, ipHash) {
  const [row] = await db`
    select 1 from app.security_events where user_id = ${userId} and ip_hash = ${ipHash} and event_type = 'login_success' limit 1`;
  return Boolean(row);
}
