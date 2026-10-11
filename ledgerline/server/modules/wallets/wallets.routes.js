import { Router } from 'express';
import { authenticate, requireAal2 } from '../../middleware/authenticate.js';
import { byUser, rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { requireMfaPolicy } from '../withdrawals/mfa-policy.js';
import * as c from './wallets.controller.js';
import * as v from './wallets.validators.js';

export function walletsRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/', c.list);
  r.get('/history', c.history);
  r.post(
    '/',
    requireMfaPolicy(),
    rateLimit({ name: 'wallet-add', max: 10, windowSeconds: 3600, key: byUser }),
    validate({ body: v.addWalletBody }),
    c.add,
  );
  r.post(
    '/:id/confirm',
    rateLimit({ name: 'wallet-confirm', max: 10, windowSeconds: 900, key: byUser }),
    validate({ params: v.idParams, body: v.confirmBody }),
    c.confirm,
  );
  r.post('/:id/resend-code', rateLimit({ name: 'wallet-resend', max: 5, windowSeconds: 3600, key: byUser }), validate({ params: v.idParams }), c.resend);
  r.post('/:id/default', validate({ params: v.idParams }), c.setDefault);
  r.delete('/:id', requireAal2(), validate({ params: v.idParams }), c.remove);
  return r;
}
