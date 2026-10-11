import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import * as c from './dashboard.controller.js';
import * as v from './dashboard.validators.js';

export function dashboardRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/', c.summary);
  r.get('/history', validate({ query: v.historyQuery }), c.history);
  return r;
}
