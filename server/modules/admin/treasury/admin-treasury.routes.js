import { Router } from 'express';
import { requirePermission } from '../../../middleware/authenticate.js';
import { idempotency } from '../../../middleware/idempotency.js';
import { validate } from '../../../middleware/validate.js';
import * as c from './admin-treasury.controller.js';
import * as v from './admin-treasury.validators.js';

export function adminTreasuryRoutes() {
  const r = Router();
  r.get('/', requirePermission('treasury.manage'), c.overview);
  r.get('/reconciliations', requirePermission('treasury.manage'), validate({ query: v.assetQuery }), c.reconciliations);
  r.post('/reconcile', requirePermission('reconciliation.run'), validate({ body: v.reconcileBody }), c.reconcile);
  r.post('/transfer', requirePermission('treasury.manage'), validate({ body: v.transferBody }), idempotency('treasury-transfer'), c.transfer);
  r.post('/capital', requirePermission('treasury.manage'), validate({ body: v.capitalBody }), idempotency('capital'), c.capital);
  r.get('/integrity', requirePermission('treasury.manage'), c.integrity);
  return r;
}
