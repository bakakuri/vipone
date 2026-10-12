// Session authentication from the HttpOnly access-token cookie.

import { getConfig } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { requestContext } from '../core/logger.js';
import { getSql } from '../db/client.js';
import { getAuthProvider } from '../integrations/auth/index.js';
import { getAuthProfile } from '../modules/profile/profile.repository.js';
import { hasPermission, STAFF_ROLES } from '../policies/permissions.js';
import { cookieNames } from './cookies.js';

async function resolveAuth(req) {
  const config = getConfig();
  const token = req.cookies?.[cookieNames(config).access];
  if (!token) return null;
  const claims = await getAuthProvider().verifyAccessToken(token);
  const profile = await getAuthProfile(getSql(), claims.userId);
  if (!profile) throw new AppError('unauthenticated', { details: { reason: 'profile_missing' } });
  if (profile.status === 'closed') throw new AppError('account_restricted', { details: { value: 'closed' } });
  const store = requestContext.getStore();
  if (store) store.userId = profile.id;
  return {
    userId: profile.id,
    email: profile.email,
    aal: claims.aal,
    sessionId: claims.sessionId,
    expiresAt: claims.exp,
    amr: claims.amr || [],
    roles: profile.roles,
    isStaff: profile.roles.some((r) => STAFF_ROLES.includes(r)),
    profile,
  };
}

export function authenticate({ optional = false } = {}) {
  return async (req, res, next) => {
    try {
      req.auth = await resolveAuth(req);
      if (!req.auth && !optional) throw new AppError('unauthenticated');
      next();
    } catch (err) {
      if (optional && err.code === 'unauthenticated') {
        req.auth = null;
        return next();
      }
      next(err);
    }
  };
}

// Requires a two-factor-verified session when the user has 2FA enabled, and
// (when `enrolled` is set) requires 2FA to be enabled at all.
export function requireAal2({ enrolled = false } = {}) {
  return (req, res, next) => {
    const { profile, aal } = req.auth;
    if (enrolled && !profile.mfa_enabled) return next(new AppError('mfa_setup_required', { status: 403 }));
    if (profile.mfa_enabled && aal !== 'aal2') return next(new AppError('mfa_required'));
    next();
  };
}

export function requireActiveAccount() {
  return (req, res, next) => {
    if (req.auth.profile.status !== 'active') {
      return next(new AppError('account_restricted', { details: { value: req.auth.profile.status } }));
    }
    next();
  };
}

// Staff routes: permission check, plus mandatory 2FA for staff in production
// (STAFF_MFA_REQUIRED=false relaxes this outside live mode). Staff who have
// turned 2FA on must always use it.
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.auth || !hasPermission(req.auth.roles, permission)) return next(new AppError('forbidden'));
    const config = getConfig();
    if (config.staffMfaRequired ?? (config.isProduction || config.isLive)) {
      if (!req.auth.profile.mfa_enabled) return next(new AppError('mfa_setup_required', { status: 403 }));
      if (req.auth.aal !== 'aal2') return next(new AppError('mfa_required'));
    } else if (req.auth.profile.mfa_enabled && config.isProduction && req.auth.aal !== 'aal2') {
      return next(new AppError('mfa_required'));
    }
    next();
  };
}
