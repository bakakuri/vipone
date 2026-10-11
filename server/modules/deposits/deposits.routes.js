import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { idempotency } from '../../middleware/idempotency.js';
import { byUser, rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as c from './deposits.controller.js';
import * as v from './deposits.validators.js';

export function depositsRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/', validate({ query: v.listQuery }), c.list);
  r.get('/address', validate({ query: v.addressQuery }), c.address);
  r.post(
    '/requests',
    rateLimit({ name: 'deposit-request', max: 20, windowSeconds: 3600, key: byUser }),
    validate({ body: v.requestBody }),
    idempotency('deposit-request'),
    c.createRequest,
  );
  r.get('/:id', validate({ params: v.idParams }), c.getOne);
  return r;
}
