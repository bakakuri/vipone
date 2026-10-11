import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { byUser, rateLimit } from '../../middleware/rate-limit.js';
import * as c from './live.controller.js';

export function liveRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/config', c.config);
  r.get('/token', rateLimit({ name: 'live-token', max: 60, windowSeconds: 600, key: byUser }), c.token);
  r.get('/stream', rateLimit({ name: 'live-stream', max: 60, windowSeconds: 600, key: byUser }), c.stream);
  return r;
}
