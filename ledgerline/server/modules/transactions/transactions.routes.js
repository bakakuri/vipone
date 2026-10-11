import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { byUser, rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as c from './transactions.controller.js';
import * as v from './transactions.validators.js';

export function transactionsRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/', validate({ query: v.listQuery }), c.list);
  r.get('/export.csv', rateLimit({ name: 'tx-export', max: 10, windowSeconds: 600, key: byUser }), validate({ query: v.listQuery }), c.exportCsv);
  r.get('/:id', validate({ params: v.idParams }), c.getOne);
  return r;
}
