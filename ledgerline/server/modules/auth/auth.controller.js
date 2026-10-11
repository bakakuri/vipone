import { getConfig } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { sendData } from '../../core/respond.js';
import { clientIpHash, userAgent } from '../../middleware/client-ip.js';
import { clearSessionCookies, cookieNames, issueCsrfCookie, setSessionCookies } from '../../middleware/cookies.js';
import { permissionsFor } from '../../policies/permissions.js';
import * as service from './auth.service.js';

const ctxOf = (req) => ({ ipHash: clientIpHash(req, getConfig()), userAgent: userAgent(req) });

export function sessionPayload(profile, aal) {
  return {
    authenticated: true,
    aal,
    mfaRequired: Boolean(profile.mfa_enabled && aal !== 'aal2'),
    user: {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      locale: profile.locale,
      theme: profile.theme,
      countryCode: profile.country_code,
      status: profile.status,
      kycStatus: profile.kyc_status,
      mfaEnabled: profile.mfa_enabled,
      onboarding: profile.onboarding,
      roles: profile.roles || [],
      permissions: permissionsFor(profile.roles || []),
      createdAt: profile.created_at,
    },
  };
}

export async function register(req, res) {
  const result = await service.register(req.body, ctxOf(req));
  sendData(res, result, { status: 202 });
}

export async function login(req, res) {
  const config = getConfig();
  const { session, profile, mfaRequired } = await service.login(req.body, ctxOf(req));
  setSessionCookies(res, config, session);
  sendData(res, { ...sessionPayload(profile, session.aal), mfaRequired });
}

export async function refresh(req, res) {
  const config = getConfig();
  try {
    const session = await service.refresh(req.cookies[cookieNames(config).refresh]);
    setSessionCookies(res, config, session);
    sendData(res, { refreshed: true, expiresAt: session.expiresAt, aal: session.aal });
  } catch (err) {
    clearSessionCookies(res, config);
    throw err;
  }
}

export async function logout(req, res) {
  const config = getConfig();
  const names = cookieNames(config);
  await service.logout({
    accessToken: req.cookies[names.access],
    refreshToken: req.cookies[names.refresh],
    userId: req.auth?.userId,
    ctx: ctxOf(req),
  });
  clearSessionCookies(res, config);
  sendData(res, { signedOut: true });
}

export async function session(req, res) {
  const config = getConfig();
  if (!req.cookies[cookieNames(config).csrf]) issueCsrfCookie(res, config);
  if (!req.auth) return sendData(res, { authenticated: false });
  sendData(res, sessionPayload(req.auth.profile, req.auth.aal));
}

export async function verifyEmail(req, res) {
  const config = getConfig();
  const { session, profile } = await service.verifyEmail(req.body, ctxOf(req));
  setSessionCookies(res, config, session);
  sendData(res, sessionPayload(profile, session.aal));
}

export async function resendConfirmation(req, res) {
  await service.resendConfirmation(req.body);
  sendData(res, { sent: true }, { status: 202 });
}

export async function forgotPassword(req, res) {
  await service.requestPasswordReset(req.body, ctxOf(req));
  sendData(res, { sent: true }, { status: 202 });
}

export async function resetPassword(req, res) {
  const config = getConfig();
  const { session, profile } = await service.resetPassword(req.body, ctxOf(req));
  setSessionCookies(res, config, session);
  sendData(res, sessionPayload(profile, session.aal));
}

export async function changePassword(req, res) {
  const config = getConfig();
  const { session, mfaRequired } = await service.changePassword(req.body, req.auth, ctxOf(req));
  setSessionCookies(res, config, session);
  sendData(res, { changed: true, mfaRequired });
}

function accessTokenOf(req) {
  const token = req.cookies[cookieNames(getConfig()).access];
  if (!token) throw new AppError('unauthenticated');
  return token;
}

export async function mfaEnroll(req, res) {
  const enrollment = await service.enrollMfa(req.auth, accessTokenOf(req));
  sendData(res, enrollment);
}

export async function mfaVerifyEnrollment(req, res) {
  const config = getConfig();
  const session = await service.verifyMfaEnrollment(req.auth, accessTokenOf(req), req.body, ctxOf(req));
  setSessionCookies(res, config, session);
  sendData(res, { enabled: true, aal: session.aal });
}

export async function mfaChallenge(req, res) {
  const config = getConfig();
  const session = await service.challengeMfa(req.auth, accessTokenOf(req), req.body, ctxOf(req));
  setSessionCookies(res, config, session);
  sendData(res, { verified: true, aal: session.aal });
}

export async function mfaDisable(req, res) {
  const config = getConfig();
  const session = await service.disableMfa(req.auth, accessTokenOf(req), req.body, ctxOf(req));
  setSessionCookies(res, config, session);
  sendData(res, { enabled: false, aal: session.aal });
}
