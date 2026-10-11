import { Router } from 'express';
import { requirePermission } from '../../../middleware/authenticate.js';
import { validate } from '../../../middleware/validate.js';
import * as c from './admin-users.controller.js';
import * as v from './admin-users.validators.js';

export function adminUsersRoutes() {
  const r = Router();
  r.get('/', requirePermission('users.read'), validate({ query: v.listQuery }), c.list);
  r.get('/risk-flags', requirePermission('users.read'), validate({ query: v.flagsQuery }), c.riskFlags);
  r.post('/risk-flags/:id/resolve', requirePermission('risk.manage'), validate({ params: v.idParams, body: v.resolveBody }), c.resolveFlag);
  r.get('/:id', requirePermission('users.read'), validate({ params: v.idParams }), c.getOne);
  r.post('/:id/status', requirePermission('users.restrict'), validate({ params: v.idParams, body: v.statusBody }), c.setStatus);
  r.post('/:id/kyc', requirePermission('kyc.review'), validate({ params: v.idParams, body: v.kycBody }), c.decideKyc);
  r.post('/:id/roles', requirePermission('users.roles.manage'), validate({ params: v.idParams, body: v.roleBody }), c.requestRole);
  return r;
}
