// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". The same header
// must be used by any external scheduler or pg_cron/pg_net caller.

import { getConfig } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { timingSafeEqualString } from '../security/crypto.js';

export function requireCronSecret() {
  return (req, res, next) => {
    const { cronSecret, isProduction } = getConfig();
    if (!cronSecret) {
      if (isProduction) return next(new AppError('forbidden'));
      return next();
    }
    const header = req.get('authorization') || '';
    if (!timingSafeEqualString(header, `Bearer ${cronSecret}`)) return next(new AppError('forbidden'));
    next();
  };
}
