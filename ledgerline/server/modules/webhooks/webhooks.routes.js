import { Router } from 'express';
import { rateLimit } from '../../middleware/rate-limit.js';
import * as c from './webhooks.controller.js';

export function webhooksRoutes() {
  const r = Router();
  const limit = rateLimit({ name: 'webhooks', max: 1200, windowSeconds: 60, key: () => 'all' });
  r.post('/blockchain/generic', limit, c.genericBlockchain);
  r.post('/blockchain/alchemy', limit, c.alchemy);
  r.post('/kyc/sumsub', limit, c.sumsub);
  return r;
}
