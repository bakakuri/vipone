// Registration, sign-in, sessions, password and two-factor flows.
// Responses never reveal whether an email is registered.

import crypto from 'node:crypto';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { getSql, withTransaction } from '../../db/client.js';
import { getAuthProvider } from '../../integrations/auth/index.js';
import { checkPassword } from '../../../public/js/validation/password-rules.js';
import * as profiles from '../profile/profile.repository.js';
import { queueEmail, dispatchSoon } from '../notifications/email-outbox.js';
import { getSetting } from '../settings/settings.service.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newReferralCode() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function assertStrongPassword(password, email) {
  const failed = checkPassword(password, email);
  if (failed.length) throw new AppError('validation_failed', { details: [{ path: 'body.password', code: 'password_weak', rules: failed }] });
}

async function assertCountryAllowed(db, countryCode) {
  const blocked = await getSetting(db, 'compliance.blocked_countries', []);
  if (Array.isArray(blocked) && blocked.includes(countryCode)) throw new AppError('country_not_supported');
}

// Creates the profile and its companions. Safe to call twice (on login we
// repair a profile whose creation failed after the auth user was created).
export async function provisionProfile(tx, { userId, email, locale, countryCode, referralCode, ipHash, userAgent }) {
  const created = await profiles.createProfile(tx, { id: userId, email, locale, countryCode, signupIpHash: ipHash });
  if (!created) return false;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rows = await tx`
      insert into app.referral_codes (user_id, code) values (${userId}, ${newReferralCode()})
      on conflict do nothing returning code`;
    if (rows.length) break;
  }

  await tx`
    insert into app.legal_acceptances (user_id, document_id, ip_hash, user_agent)
    select ${userId}, id, ${ipHash}, ${userAgent} from app.legal_documents
    where is_current and locale = ${locale} and doc_type in ('terms', 'privacy', 'risk')
    on conflict do nothing`;

  if (referralCode) {
    const [code] = await tx`select user_id from app.referral_codes where code = ${referralCode}`;
    if (code && code.user_id !== userId) await tx`select app.register_referral(${userId}, ${referralCode})`;
  }
  return true;
}

export async function register(input, { ipHash, userAgent }) {
  const config = getConfig();
  const sql = getSql();
  assertStrongPassword(input.password, input.email);
  await assertCountryAllowed(sql, input.countryCode);
  if (input.referralCode) {
    const [code] = await sql`select 1 from app.referral_codes where code = ${input.referralCode}`;
    if (!code) throw new AppError('referral_code_invalid', { status: 422 });
  }

  const provider = getAuthProvider();
  const result = await provider.signUp({
    email: input.email,
    password: input.password,
    redirectTo: `${config.appUrl}/verify-email`,
    metadata: { locale: input.locale, country_code: input.countryCode, referral_code: input.referralCode || null },
  });

  if (result.userId) {
    try {
      await withTransaction((tx) =>
        provisionProfile(tx, {
          userId: result.userId,
          email: input.email,
          locale: input.locale,
          countryCode: input.countryCode,
          referralCode: input.referralCode,
          ipHash,
          userAgent,
        }),
      );
    } catch (err) {
      // The profile is repaired on first login from the signup metadata.
      logger.error('profile_provisioning_failed', { error: err.message });
    }
    if (result.emailToken) {
      await queueEmail(sql, {
        to: input.email,
        template: 'confirm_email',
        locale: input.locale,
        params: { actionUrl: `${config.appUrl}/verify-email?token_hash=${encodeURIComponent(result.emailToken)}&type=signup` },
      });
      await dispatchSoon();
    }
  } else if (result.existing && !provider.sendsOwnEmails) {
    await queueEmail(sql, { to: input.email, template: 'account_exists', locale: input.locale, params: { actionUrl: `${config.appUrl}/login` } });
    await dispatchSoon();
  }
  // Same answer whether or not the address was already registered.
  return { confirmationRequired: true };
}

async function ensureProfile(session, ctx) {
  const sql = getSql();
  let profile = await profiles.getAuthProfile(sql, session.user.id);
  if (!profile) {
    const meta = session.user.metadata || {};
    await withTransaction((tx) =>
      provisionProfile(tx, {
        userId: session.user.id,
        email: session.user.email,
        locale: ['en', 'ru', 'ar', 'ka'].includes(meta.locale) ? meta.locale : 'en',
        countryCode: /^[A-Z]{2}$/.test(meta.country_code || '') ? meta.country_code : null,
        referralCode: meta.referral_code || null,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent,
      }),
    );
    profile = await profiles.getAuthProfile(sql, session.user.id);
  }
  return profile;
}

export async function login({ email, password }, ctx) {
  const sql = getSql();
  let session;
  try {
    session = await getAuthProvider().signIn({ email, password });
  } catch (err) {
    if (err.code === 'invalid_credentials') {
      const [p] = await sql`select id from app.profiles where lower(email) = ${email}`;
      if (p) await profiles.recordSecurityEvent(sql, { userId: p.id, type: 'login_failed', ipHash: ctx.ipHash, userAgent: ctx.userAgent });
    }
    throw err;
  }
  const profile = await ensureProfile(session, ctx);
  if (profile.status === 'closed') throw new AppError('account_restricted', { details: { value: 'closed' } });

  const knownDevice = await profiles.hasSeenIpHash(sql, profile.id, ctx.ipHash);
  await profiles.recordSecurityEvent(sql, { userId: profile.id, type: 'login_success', ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  await profiles.touchLogin(sql, profile.id);
  const [{ count }] = await sql`select count(*)::int from app.security_events where user_id = ${profile.id} and event_type = 'login_success'`;
  if (!knownDevice && count > 1) {
    await profiles.recordSecurityEvent(sql, { userId: profile.id, type: 'new_device', ipHash: ctx.ipHash, userAgent: ctx.userAgent });
    await sql`select app.notify(${profile.id}, 'security_alert', ${sql.json({ kind: 'new_device' })}, '/security')`;
    await queueEmail(sql, { to: profile.email, template: 'new_device_login', locale: profile.locale, params: { userAgent: ctx.userAgent || '' } });
    await dispatchSoon();
  }
  return { session, profile, mfaRequired: profile.mfa_enabled && session.aal !== 'aal2' };
}

export async function refresh(refreshToken) {
  if (!refreshToken) throw new AppError('session_expired');
  return getAuthProvider().refresh(refreshToken);
}

export async function logout({ accessToken, refreshToken, userId, ctx }) {
  await getAuthProvider().signOut(accessToken, refreshToken);
  if (userId) await profiles.recordSecurityEvent(getSql(), { userId, type: 'logout', ipHash: ctx.ipHash, userAgent: ctx.userAgent });
}

export async function verifyEmail({ tokenHash, type }, ctx) {
  const session = await getAuthProvider().verifyEmailToken({ tokenHash, type });
  if (!session) throw new AppError('link_expired');
  const profile = await ensureProfile(session, ctx);
  if (type !== 'recovery') {
    const sql = getSql();
    const [already] = await sql`select 1 from app.security_events where user_id = ${profile.id} and event_type = 'email_confirmed'`;
    if (!already) {
      await profiles.recordSecurityEvent(sql, { userId: profile.id, type: 'email_confirmed', ipHash: ctx.ipHash, userAgent: ctx.userAgent });
      await sql`select app.notify(${profile.id}, 'registration_completed', '{}'::jsonb, '/dashboard')`;
    }
  }
  return { session, profile };
}

export async function resendConfirmation({ email }) {
  const config = getConfig();
  const result = await getAuthProvider().resendConfirmation({ email, redirectTo: `${config.appUrl}/verify-email` });
  if (result.emailToken) {
    const sql = getSql();
    const [p] = await sql`select locale from app.profiles where lower(email) = ${email}`;
    await queueEmail(sql, {
      to: email,
      template: 'confirm_email',
      locale: p?.locale || 'en',
      params: { actionUrl: `${config.appUrl}/verify-email?token_hash=${encodeURIComponent(result.emailToken)}&type=signup` },
    });
    await dispatchSoon();
  }
}

export async function requestPasswordReset({ email }, ctx) {
  const config = getConfig();
  const sql = getSql();
  const result = await getAuthProvider().requestPasswordReset({ email, redirectTo: `${config.appUrl}/reset-password` });
  const [p] = await sql`select id, locale from app.profiles where lower(email) = ${email}`;
  if (p) await profiles.recordSecurityEvent(sql, { userId: p.id, type: 'password_reset_requested', ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  if (result.emailToken) {
    await queueEmail(sql, {
      to: email,
      template: 'reset_password',
      locale: p?.locale || 'en',
      params: { actionUrl: `${config.appUrl}/reset-password?token_hash=${encodeURIComponent(result.emailToken)}&type=recovery` },
    });
    await dispatchSoon();
  }
}

export async function resetPassword({ tokenHash, password }, ctx) {
  const provider = getAuthProvider();
  const recovery = await provider.verifyEmailToken({ tokenHash, type: 'recovery' });
  if (!recovery) throw new AppError('link_expired');
  assertStrongPassword(password, recovery.user.email);
  await provider.updatePassword({ accessToken: recovery.accessToken, password });
  await provider.signOutOthers(recovery.accessToken);
  const profile = await ensureProfile(recovery, ctx);
  await afterPasswordChange(profile, ctx);
  return { session: recovery, profile };
}

export async function changePassword({ currentPassword, newPassword }, auth, ctx) {
  const provider = getAuthProvider();
  assertStrongPassword(newPassword, auth.email);
  // Re-authenticate with the current password; this also yields a fresh session.
  const fresh = await provider.signIn({ email: auth.email, password: currentPassword });
  await provider.updatePassword({ accessToken: fresh.accessToken, password: newPassword });
  await provider.signOutOthers(fresh.accessToken);
  await afterPasswordChange(auth.profile, ctx);
  // Every other session (including the previous cookie session) is signed out;
  // the caller switches to the fresh session. With 2FA on, the fresh session
  // is aal1, so the next sensitive action asks for a code again.
  return { session: fresh, mfaRequired: auth.profile.mfa_enabled && fresh.aal !== 'aal2' };
}

async function afterPasswordChange(profile, ctx) {
  const sql = getSql();
  await profiles.recordSecurityEvent(sql, { userId: profile.id, type: 'password_changed', ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  await sql`select app.notify(${profile.id}, 'security_alert', ${sql.json({ kind: 'password_changed' })}, '/security')`;
  await queueEmail(sql, { to: profile.email, template: 'password_changed', locale: profile.locale, params: {} });
  await dispatchSoon();
}

// Two-factor authentication -------------------------------------------------------

export async function enrollMfa(auth, accessToken) {
  if (auth.profile.mfa_enabled) throw new AppError('mfa_already_enabled', { status: 409 });
  try {
    return await getAuthProvider().mfa.enroll(accessToken, { friendlyName: `${getConfig().appName} authenticator`, issuer: getConfig().appName });
  } catch (err) {
    // The auth service already has a verified authenticator for this user
    // (e.g. set up before the profile flag was saved): keep the flag in sync.
    if (err.code === 'mfa_already_enabled') await profiles.setMfaEnabled(getSql(), auth.userId, true);
    throw err;
  }
}

export async function verifyMfaEnrollment(auth, accessToken, { factorId, code }, ctx) {
  const session = await getAuthProvider().mfa.verify(accessToken, factorId, code);
  const sql = getSql();
  await profiles.setMfaEnabled(sql, auth.userId, true);
  await profiles.recordSecurityEvent(sql, { userId: auth.userId, type: 'mfa_enabled', ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  await sql`select app.notify(${auth.userId}, 'security_alert', ${sql.json({ kind: 'mfa_enabled' })}, '/security')`;
  return session;
}

async function verifiedFactor(accessToken) {
  const user = await getAuthProvider().getUser(accessToken);
  const factor = user.factors.find((f) => f.status === 'verified');
  if (!factor) throw new AppError('mfa_not_enabled', { status: 409 });
  return factor;
}

export async function challengeMfa(auth, accessToken, { code }, ctx) {
  const factor = await verifiedFactor(accessToken);
  try {
    return await getAuthProvider().mfa.verify(accessToken, factor.id, code);
  } catch (err) {
    if (err.code === 'mfa_invalid_code') {
      await profiles.recordSecurityEvent(getSql(), { userId: auth.userId, type: 'mfa_failed', ipHash: ctx.ipHash, userAgent: ctx.userAgent });
    }
    throw err;
  }
}

export async function disableMfa(auth, accessToken, { code }, ctx) {
  const factor = await verifiedFactor(accessToken);
  const session = await getAuthProvider().mfa.verify(accessToken, factor.id, code);
  await getAuthProvider().mfa.unenroll(session.accessToken, factor.id);
  const sql = getSql();
  await profiles.setMfaEnabled(sql, auth.userId, false);
  await profiles.recordSecurityEvent(sql, { userId: auth.userId, type: 'mfa_disabled', ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  await sql`select app.notify(${auth.userId}, 'security_alert', ${sql.json({ kind: 'mfa_disabled' })}, '/security')`;
  await queueEmail(sql, { to: auth.email, template: 'mfa_disabled', locale: auth.profile.locale, params: {} });
  await dispatchSoon();
  // After unenrolling, refresh to obtain a session without the removed factor.
  return getAuthProvider().refresh(session.refreshToken);
}
