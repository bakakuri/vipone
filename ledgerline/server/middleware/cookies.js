// Cookie parsing and the session cookie contract.
//
//   <prefix>ll_at   access token   HttpOnly, Secure, SameSite=Strict
//   <prefix>ll_rt   refresh token  HttpOnly, Secure, SameSite=Strict
//   <prefix>ll_csrf CSRF token     readable by JS (double-submit), Secure, SameSite=Strict
// prefix is "__Host-" in production (cookie bound to this exact host, path /).

import { randomToken } from '../security/crypto.js';

export function cookieNames(config) {
  const p = config.cookies.prefix;
  return { access: `${p}ll_at`, refresh: `${p}ll_rt`, csrf: `${p}ll_csrf` };
}

export function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name || name in out) continue;
    let value = part.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function cookieParser() {
  return (req, res, next) => {
    req.cookies = parseCookieHeader(req.headers.cookie);
    next();
  };
}

function baseOptions(config) {
  return {
    secure: config.cookies.secure,
    sameSite: 'strict',
    path: '/',
    ...(config.cookies.domain && !config.cookies.prefix ? { domain: config.cookies.domain } : {}),
  };
}

export function setSessionCookies(res, config, session) {
  const names = cookieNames(config);
  const accessMaxAge = Math.max(60, session.expiresAt * 1000 - Date.now());
  res.cookie(names.access, session.accessToken, { ...baseOptions(config), httpOnly: true, maxAge: accessMaxAge });
  res.cookie(names.refresh, session.refreshToken, { ...baseOptions(config), httpOnly: true, maxAge: 30 * 24 * 3600 * 1000 });
  return issueCsrfCookie(res, config);
}

export function issueCsrfCookie(res, config) {
  const token = randomToken(24);
  res.cookie(cookieNames(config).csrf, token, { ...baseOptions(config), httpOnly: false, maxAge: 30 * 24 * 3600 * 1000 });
  return token;
}

export function clearSessionCookies(res, config) {
  const names = cookieNames(config);
  for (const name of Object.values(names)) res.clearCookie(name, baseOptions(config));
}
