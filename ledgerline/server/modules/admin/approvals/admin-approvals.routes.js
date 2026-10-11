import { Router } from 'express';
import { requirePermission } from '../../../middleware/authenticate.js';
import { validate } from '../../../middleware/validate.js';
import * as c from './admin-approvals.controller.js';
import * as v from './admin-approvals.validators.js';

export function adminApprovalsRoutes() {
  const r = Router();
  r.get('/', requirePermission('approvals.read'), validate({ query: v.listQuery }), c.list);
  r.post('/:id/approve', requirePermission('approvals.decide'), validate({ params: v.idParams, body: v.decisionBody }), c.approve);
  r.post('/:id/reject', requirePermission('approvals.decide'), validate({ params: v.idParams, body: v.rejectBody }), c.reject);
  return r;
}
