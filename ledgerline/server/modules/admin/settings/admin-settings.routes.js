import { Router } from 'express';
import { requirePermission } from '../../../middleware/authenticate.js';
import { validate } from '../../../middleware/validate.js';
import * as c from './admin-settings.controller.js';
import * as v from './admin-settings.validators.js';

export function adminSettingsRoutes() {
  const r = Router();
  r.get('/', requirePermission('settings.read'), c.list);
  r.get('/fee-rules', requirePermission('settings.read'), c.feeRules);
  r.post('/fee-rules', requirePermission('settings.request'), validate({ body: v.feeRuleBody }), c.requestFeeRule);
  r.post('/adjustments', requirePermission('treasury.manage'), validate({ body: v.adjustmentBody }), c.requestAdjustment);
  r.get('/:key/history', requirePermission('settings.read'), validate({ params: v.keyParams }), c.history);
  r.post('/:key', requirePermission('settings.request'), validate({ params: v.keyParams, body: v.changeBody }), c.change);
  return r;
}
