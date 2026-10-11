import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import * as c from './referrals.controller.js';
import * as v from './referrals.validators.js';

export function referralsRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/', c.overview);
  r.get('/rewards', validate({ query: v.rewardsQuery }), c.rewards);
  return r;
}
