// Setting withdrawal.require_mfa (default true): adding withdrawal addresses
// and requesting withdrawals require two-factor authentication to be enabled
// and verified in the current session.

import { getSql } from '../../db/client.js';
import { requireAal2 } from '../../middleware/authenticate.js';
import { getSetting } from '../settings/settings.service.js';

export function requireMfaPolicy() {
  return async (req, res, next) => {
    try {
      const required = await getSetting(getSql(), 'withdrawal.require_mfa', true);
      requireAal2({ enrolled: required !== false })(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}
