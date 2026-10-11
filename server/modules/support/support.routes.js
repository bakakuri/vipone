import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { byUser, rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as c from './support.controller.js';
import * as v from './support.validators.js';

export function supportRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/tickets', c.list);
  r.post('/tickets', rateLimit({ name: 'ticket-create', max: 10, windowSeconds: 3600, key: byUser }), validate({ body: v.createBody }), c.create);
  r.get('/tickets/:id', validate({ params: v.idParams }), c.getOne);
  r.post(
    '/tickets/:id/messages',
    rateLimit({ name: 'ticket-message', max: 30, windowSeconds: 3600, key: byUser }),
    validate({ params: v.idParams, body: v.messageBody }),
    c.addMessage,
  );
  return r;
}
