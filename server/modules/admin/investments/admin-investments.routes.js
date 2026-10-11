import { Router } from 'express';
import { requirePermission } from '../../../middleware/authenticate.js';
import { validate } from '../../../middleware/validate.js';
import * as c from './admin-investments.controller.js';
import * as v from './admin-investments.validators.js';

export function adminInvestmentsRoutes() {
  const r = Router();
  const id = validate({ params: v.idParams });
  r.get('/products', requirePermission('investments.read'), c.products);
  r.post('/products', requirePermission('investments.products.manage'), validate({ body: v.createProductBody }), c.createProduct);
  r.patch('/products/:id', requirePermission('investments.products.manage'), id, validate({ body: v.updateProductBody }), c.updateProduct);
  r.post('/products/:id/status', requirePermission('investments.products.manage'), id, validate({ body: v.statusBody }), c.setStatus);
  r.get('/results', requirePermission('investments.read'), validate({ query: v.resultsQuery }), c.results);
  r.post('/results', requirePermission('investments.results.create'), validate({ body: v.createResultBody }), c.createResult);
  r.get('/results/:id/preview', requirePermission('investments.read'), id, c.previewResult);
  r.post('/results/:id/approve', requirePermission('investments.results.approve'), id, c.approveResult);
  r.post('/results/:id/reject', requirePermission('investments.results.approve'), id, validate({ body: v.rejectBody }), c.rejectResult);
  r.post('/results/:id/post', requirePermission('investments.results.approve'), id, c.postResult);
  return r;
}
