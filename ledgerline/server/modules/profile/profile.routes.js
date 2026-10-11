import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { byUser, rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as c from './profile.controller.js';
import * as v from './profile.validators.js';

export function profileRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/', c.get);
  r.patch('/', validate({ body: v.preferencesBody }), c.updatePreferences);
  r.patch('/onboarding', validate({ body: v.onboardingBody }), c.updateOnboarding);
  r.get('/security-events', c.securityEvents);
  r.post('/kyc/start', rateLimit({ name: 'kyc-start', max: 5, windowSeconds: 3600, key: byUser }), c.startKyc);
  return r;
}
