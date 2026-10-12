import { Router } from 'express';
import { requirePermission } from '../../../middleware/authenticate.js';
import { validate } from '../../../middleware/validate.js';
import * as c from './admin-withdrawals.controller.js';
import * as v from './admin-withdrawals.validators.js';

export function adminWithdrawalsRoutes() {
  const r = Router();
  const id = validate({ params: v.idParams });
  r.get('/', requirePermission('withdrawals.read'), validate({ query: v.listQuery }), c.list);
  r.get('/:id', requirePermission('withdrawals.read'), id, c.getOne);
  r.post('/:id/review', requirePermission('withdrawals.review'), id, validate({ body: v.reasonBody }), c.review);
  r.post('/:id/approve', requirePermission('withdrawals.approve'), id, c.approve);
  r.post('/:id/reject', requirePermission('withdrawals.review'), id, validate({ body: v.reasonBody }), c.reject);
  r.post('/:id/process', requirePermission('withdrawals.process'), id, c.process);
  r.post('/:id/broadcast', requirePermission('withdrawals.process'), id, validate({ body: v.broadcastBody }), c.broadcast);
  r.post('/:id/complete', requirePermission('withdrawals.process'), id, validate({ body: v.completeBody }), c.complete);
  r.post('/:id/pay', requirePermission('withdrawals.process'), id, validate({ body: v.payBody }), c.pay);
  r.post('/:id/fail', requirePermission('withdrawals.process'), id, validate({ body: v.failBody }), c.fail);
  return r;
}
