import { Router } from 'express';
import { requirePermission } from '../../../middleware/authenticate.js';
import { validate } from '../../../middleware/validate.js';
import * as c from './admin-deposits.controller.js';
import * as v from './admin-deposits.validators.js';

export function adminDepositsRoutes() {
  const r = Router();
  r.get('/', requirePermission('deposits.read'), validate({ query: v.listQuery }), c.list);
  r.get('/address-pool', requirePermission('deposits.read'), c.pool);
  r.post('/address-pool/import', requirePermission('addresses.manage'), validate({ body: v.importBody }), c.importPool);
  r.get('/:id', requirePermission('deposits.read'), validate({ params: v.idParams }), c.getOne);
  r.post('/:id/review', requirePermission('deposits.review'), validate({ params: v.idParams, body: v.reviewBody }), c.review);
  r.post('/:id/return', requirePermission('deposits.return'), validate({ params: v.idParams, body: v.returnBody }), c.returnFunds);
  return r;
}
