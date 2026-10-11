// The user's own profile, preferences, onboarding progress, security log and
// identity verification.

import { AppError } from '../../core/errors.js';
import { getSql, withTransaction } from '../../db/client.js';
import { getKycProvider } from '../../integrations/kyc/index.js';
import { camelize } from '../../utils/camelize.js';
import * as repo from './profile.repository.js';

export async function getProfile(userId) {
  const sql = getSql();
  const profile = await repo.getAuthProfile(sql, userId);
  if (!profile) throw new AppError('not_found');
  const kyc = await sql`
    select provider, level, status, reason, created_at, updated_at from app.kyc_verifications
    where user_id = ${userId} order by created_at desc limit 5`;
  const legal = await sql`
    select d.doc_type, d.version, d.locale, d.path, a.accepted_at
    from app.legal_acceptances a join app.legal_documents d on d.id = a.document_id
    where a.user_id = ${userId} order by a.accepted_at desc`;
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    locale: profile.locale,
    theme: profile.theme,
    countryCode: profile.country_code,
    status: profile.status,
    statusReason: profile.status === 'active' ? null : profile.status_reason,
    kycStatus: profile.kyc_status,
    mfaEnabled: profile.mfa_enabled,
    onboarding: profile.onboarding,
    createdAt: profile.created_at,
    kyc: kyc.map(camelize),
    legalAcceptances: legal.map(camelize),
  };
}

export async function updatePreferences(userId, input) {
  return camelize(await repo.updatePreferences(getSql(), userId, input));
}

export async function updateOnboarding(userId, input) {
  const sql = getSql();
  const profile = await repo.getAuthProfile(sql, userId);
  const next = { ...profile.onboarding, ...input };
  return repo.updateOnboarding(sql, userId, next);
}

export async function securityEvents(userId) {
  return (await repo.listSecurityEvents(getSql(), userId, 30)).map(camelize);
}

export async function startKyc(auth) {
  if (auth.profile.kyc_status === 'approved') throw new AppError('kyc_already_approved', { status: 409 });
  const provider = getKycProvider();
  const start = await provider.startVerification({ userId: auth.userId, locale: auth.profile.locale });
  await withTransaction(async (tx) => {
    await tx`
      insert into app.kyc_verifications (user_id, provider, provider_reference, status)
      values (${auth.userId}, ${provider.name}, ${start.providerReference}, 'pending')
      on conflict (provider, provider_reference) do update set status = 'pending', updated_at = now()`;
    await tx`update app.profiles set kyc_status = 'pending' where id = ${auth.userId} and kyc_status <> 'approved'`;
  });
  return { mode: start.mode, url: start.url };
}
