import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { idempotency } from '../../middleware/idempotency.js';
import { byUser, rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as c from './investments.controller.js';
import * as v from './investments.validators.js';

export function investmentsRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/products', c.products);
  r.get('/positions', validate({ query: v.listQuery }), c.positions);
  r.get('/positions/:id', validate({ params: v.idParams }), c.position);
  r.post(
    '/positions',
    rateLimit({ name: 'position-open', max: 20, windowSeconds: 3600, key: byUser }),
    validate({ body: v.openBody }),
    idempotency('position-open'),
    c.open,
  );
  r.post('/positions/:id/close', validate({ params: v.idParams }), idempotency('position-close'), c.closeEarly);
  return r;
}
