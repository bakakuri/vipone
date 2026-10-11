// CSRF protection for cookie-authenticated requests:
//  1. state-changing requests from a browser must come from an allowed Origin
//  2. requests that carry a session cookie must echo the CSRF cookie in the
//     X-CSRF-Token header (double-submit; SameSite=Strict adds a third layer)
// Webhooks and cron endpoints authenticate with signatures instead.

import { getConfig } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { timingSafeEqualString } from '../security/crypto.js';
import { cookieNames } from './cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT = [/^\/api\/v1\/webhooks\//, /^\/api\/v1\/jobs\//, /^\/api\/v1\/client-errors$/];

export function csrfProtection() {
  return (req, res, next) => {
    const config = getConfig();
    const names = cookieNames(config);
    const allowed = new Set(config.allowedOrigins.map((o) => o.replace(/\/$/, '')));
    if (SAFE_METHODS.has(req.method)) return next();
    const path = req.originalUrl.split('?')[0];
    if (EXEMPT.some((re) => re.test(path))) return next();

    const origin = req.get('origin');
    if (origin && !allowed.has(origin)) return next(new AppError('origin_not_allowed'));
    const site = req.get('sec-fetch-site');
    if (!origin && site && site !== 'same-origin' && site !== 'none') return next(new AppError('origin_not_allowed'));

    const hasSession = Boolean(req.cookies?.[names.access] || req.cookies?.[names.refresh]);
    if (hasSession) {
      const cookieToken = req.cookies?.[names.csrf];
      const headerToken = req.get('x-csrf-token');
      if (!cookieToken || !headerToken || !timingSafeEqualString(cookieToken, headerToken)) {
        return next(new AppError('csrf_failed'));
      }
    }
    return next();
  };
}
