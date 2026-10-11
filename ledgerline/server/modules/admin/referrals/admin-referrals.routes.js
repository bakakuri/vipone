import { Router } from 'express';
import { requirePermission } from '../../../middleware/authenticate.js';
import { validate } from '../../../middleware/validate.js';
import * as c from './admin-referrals.controller.js';
import * as v from './admin-referrals.validators.js';

export function adminReferralsRoutes() {
  const r = Router();
  r.get('/rewards', requirePermission('referrals.read'), validate({ query: v.rewardsQuery }), c.rewards);
  r.get('/relationships', requirePermission('referrals.read'), validate({ query: v.relationshipsQuery }), c.relationships);
  r.get('/suspicious', requirePermission('referrals.read'), c.suspicious);
  r.post('/rewards/:id/review', requirePermission('referrals.review'), validate({ params: v.idParams, body: v.reviewBody }), c.review);
  return r;
}
