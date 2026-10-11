import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import * as c from './earnings.controller.js';
import * as v from './earnings.validators.js';

export function earningsRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/', validate({ query: v.listQuery }), c.list);
  r.get('/summary', c.summary);
  return r;
}
