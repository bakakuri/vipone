// Supabase Auth (GoTrue) over its REST API, called only from the server.
// The browser never receives Supabase tokens except a short-lived access
// token kept in memory for Realtime (see modules/live). Sessions live in
// HttpOnly cookies set by our API.
//
// Required configuration: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY.
// Access tokens are verified locally against the project's JWKS
// (asymmetric signing keys); SUPABASE_JWT_SECRET enables legacy HS256 projects.

import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { createJwksResolver, decodeUnverified, verifyJwt, JwtError } from '../../security/jwt.js';

const ERROR_MAP = {
  invalid_credentials: 'invalid_credentials',
  invalid_grant: 'invalid_credentials',
  email_not_confirmed: 'email_not_confirmed',
  user_already_exists: 'user_exists',
  email_exists: 'user_exists',
  weak_password: 'password_weak',
  over_email_send_rate_limit: 'rate_limited',
  over_request_rate_limit: 'rate_limited',
  over_sms_send_rate_limit: 'rate_limited',
  refresh_token_not_found: 'session_expired',
  refresh_token_already_used: 'session_expired',
  session_not_found: 'session_expired',
  session_expired: 'session_expired',
  bad_jwt: 'session_expired',
  mfa_verification_failed: 'mfa_invalid_code',
  mfa_challenge_expired: 'mfa_invalid_code',
  mfa_factor_not_found: 'not_found',
  mfa_totp_enroll_not_enabled: 'mfa_unavailable',
  mfa_totp_verify_not_enabled: 'mfa_unavailable',
  insufficient_aal: 'mfa_required',
  mfa_factor_name_conflict: 'mfa_setup_failed',
  too_many_enrolled_mfa_factors: 'mfa_setup_failed',
  mfa_ip_address_mismatch: 'mfa_setup_failed',
  otp_expired: 'link_expired',
  same_password: 'password_same',
  reauthentication_needed: 'reauthentication_required',
};

function mapError(status, body, path) {
  const raw = body?.error_code || body?.code || body?.error || '';
  const code = ERROR_MAP[raw] || (status === 429 ? 'rate_limited' : status >= 500 ? 'service_unavailable' : null);
  if (code && ERROR_MAP[raw] && /^mfa_|^too_many_enrolled/.test(raw)) {
    // Logged so a configuration problem in Supabase is visible in the function log.
    logger.warn('auth_provider_error', { status, providerCode: raw, path });
  }
  if (code) return new AppError(code);
  if (/invalid login credentials/i.test(body?.msg || body?.error_description || '')) return new AppError('invalid_credentials');
  // Unknown refusal: keep the provider's code in the log (never tokens or passwords).
  logger.warn('auth_provider_error', { status, providerCode: String(raw).slice(0, 80) || null, path, message: String(body?.msg || body?.error_description || body?.message || '').slice(0, 200) });
  return new AppError('auth_failed', { status: status >= 400 && status < 500 ? 400 : 502 });
}

function toSession(body) {
  if (!body?.access_token) return null;
  let aal = 'aal1';
  try {
    aal = decodeUnverified(body.access_token).payload.aal || 'aal1';
  } catch {
    /* keep default */
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_at || Math.floor(Date.now() / 1000) + (body.expires_in || 3600),
    aal,
    user: body.user
      ? {
          id: body.user.id,
          email: body.user.email,
          emailConfirmed: Boolean(body.user.email_confirmed_at || body.user.confirmed_at),
          metadata: body.user.user_metadata || {},
        }
      : null,
  };
}

export function createSupabaseAuthProvider(config, { fetchImpl = fetch } = {}) {
  const base = `${config.auth.supabaseUrl}/auth/v1`;
  const getJwk = createJwksResolver(`${base}/.well-known/jwks.json`, { fetchImpl });

  async function call(method, path, { body, token, query } = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined) url.searchParams.set(k, v);
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: {
          apikey: config.auth.publishableKey,
          'content-type': 'application/json',
          accept: 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      throw new AppError('service_unavailable', { cause: err });
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) throw mapError(res.status, data, `${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`);
    return data;
  }

  return {
    name: 'supabase',
    sendsOwnEmails: true,

    async signUp({ email, password, redirectTo, metadata }) {
      const data = await call('POST', '/signup', { body: { email, password, data: metadata || {} }, query: { redirect_to: redirectTo } });
      const user = data?.user || data;
      // With email confirmation on, Supabase answers an already-registered
      // address with an obfuscated user that has no identities (no enumeration).
      const existing = Array.isArray(user?.identities) && user.identities.length === 0;
      return { userId: existing ? null : user?.id || null, existing, confirmationRequired: !data?.access_token, session: toSession(data) };
    },

    async signIn({ email, password }) {
      return toSession(await call('POST', '/token', { query: { grant_type: 'password' }, body: { email, password } }));
    },

    async refresh(refreshToken) {
      return toSession(await call('POST', '/token', { query: { grant_type: 'refresh_token' }, body: { refresh_token: refreshToken } }));
    },

    async signOut(accessToken) {
      if (!accessToken) return;
      try {
        await call('POST', '/logout', { token: accessToken, query: { scope: 'local' } });
      } catch {
        /* the session may already be gone; cookies are cleared regardless */
      }
    },

    async signOutOthers(accessToken) {
      try {
        await call('POST', '/logout', { token: accessToken, query: { scope: 'others' } });
      } catch {
        /* best effort */
      }
    },

    async verifyAccessToken(token) {
      try {
        const claims = await verifyJwt(token, {
          getJwk,
          hsSecret: config.auth.supabaseJwtSecret,
          audience: 'authenticated',
          issuer: base,
        });
        return { userId: claims.sub, email: claims.email, aal: claims.aal || 'aal1', sessionId: claims.session_id, exp: claims.exp, amr: claims.amr };
      } catch (err) {
        if (err instanceof JwtError && err.code === 'expired') throw new AppError('token_expired');
        if (err instanceof JwtError && err.code === 'jwks_unavailable') throw new AppError('service_unavailable');
        throw new AppError('unauthenticated');
      }
    },

    async verifyEmailToken({ tokenHash, type }) {
      return toSession(await call('POST', '/verify', { body: { type, token_hash: tokenHash } }));
    },

    async resendConfirmation({ email, redirectTo }) {
      await call('POST', '/resend', { body: { type: 'signup', email }, query: { redirect_to: redirectTo } });
      return {};
    },

    async requestPasswordReset({ email, redirectTo }) {
      await call('POST', '/recover', { body: { email }, query: { redirect_to: redirectTo } });
      return {};
    },

    async updatePassword({ accessToken, password }) {
      await call('PUT', '/user', { token: accessToken, body: { password } });
    },

    async getUser(accessToken) {
      const user = await call('GET', '/user', { token: accessToken });
      return {
        id: user.id,
        email: user.email,
        factors: (user.factors || []).filter((f) => f.factor_type === 'totp').map((f) => ({ id: f.id, status: f.status, createdAt: f.created_at })),
      };
    },

    mfa: {
      async enroll(accessToken, { friendlyName, issuer }) {
        // An earlier setup that was opened but never finished leaves an
        // unverified factor behind; Supabase then refuses a new one (same
        // name, factor limit). Remove those first, like the local provider.
        const user = await call('GET', '/user', { token: accessToken });
        const totp = (user.factors || []).filter((f) => f.factor_type === 'totp');
        if (totp.some((f) => f.status === 'verified')) throw new AppError('mfa_already_enabled', { status: 409 });
        for (const f of totp) {
          await call('DELETE', `/factors/${encodeURIComponent(f.id)}`, { token: accessToken });
        }
        // A unique name avoids conflicts with factors Supabase has not cleaned up yet.
        const name = `${friendlyName} ${Date.now().toString(36)}`.slice(0, 120);
        const data = await call('POST', '/factors', { token: accessToken, body: { factor_type: 'totp', friendly_name: name, issuer } });
        return { factorId: data.id, secret: data.totp?.secret, uri: data.totp?.uri };
      },
      async verify(accessToken, factorId, code) {
        const challenge = await call('POST', `/factors/${encodeURIComponent(factorId)}/challenge`, { token: accessToken, body: {} });
        const data = await call('POST', `/factors/${encodeURIComponent(factorId)}/verify`, {
          token: accessToken,
          body: { challenge_id: challenge.id, code },
        });
        return toSession(data);
      },
      async unenroll(accessToken, factorId) {
        await call('DELETE', `/factors/${encodeURIComponent(factorId)}`, { token: accessToken });
      },
    },
  };
}
