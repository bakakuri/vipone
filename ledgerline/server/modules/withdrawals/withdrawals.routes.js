import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { idempotency } from '../../middleware/idempotency.js';
import { byUser, rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as c from './withdrawals.controller.js';
import { requireMfaPolicy } from './mfa-policy.js';
import * as v from './withdrawals.validators.js';

export function withdrawalsRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/', validate({ query: v.listQuery }), c.list);
  r.post('/quote', rateLimit({ name: 'withdrawal-quote', max: 60, windowSeconds: 600, key: byUser }), validate({ body: v.quoteBody }), c.quote);
  r.post(
    '/',
    requireMfaPolicy(),
    rateLimit({ name: 'withdrawal-create', max: 10, windowSeconds: 3600, key: byUser }),
    validate({ body: v.createBody }),
    idempotency('withdrawal'),
    c.create,
  );
  r.get('/:id', validate({ params: v.idParams }), c.getOne);
  r.post('/:id/cancel', validate({ params: v.idParams }), c.cancel);
  return r;
}
