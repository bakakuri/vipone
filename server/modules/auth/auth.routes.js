import { Router } from 'express';
import { authenticate, requireAal2 } from '../../middleware/authenticate.js';
import { byEmail, byUser, rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as c from './auth.controller.js';
import * as v from './auth.validators.js';

export function authRoutes() {
  const r = Router();
  const ipLimit = (name, max, windowSeconds) => rateLimit({ name, max, windowSeconds });

  r.post('/register', ipLimit('register', 5, 3600), validate({ body: v.registerSchema }), c.register);
  r.post(
    '/login',
    ipLimit('login-ip', 20, 900),
    validate({ body: v.loginSchema }),
    rateLimit({ name: 'login-email', max: 8, windowSeconds: 900, key: byEmail }),
    c.login,
  );
  r.post('/refresh', ipLimit('refresh', 60, 300), c.refresh);
  r.post('/logout', authenticate({ optional: true }), c.logout);
  r.get('/session', authenticate({ optional: true }), c.session);
  r.post('/verify-email', ipLimit('verify-email', 20, 900), validate({ body: v.verifyEmailSchema }), c.verifyEmail);
  r.post(
    '/resend-confirmation',
    ipLimit('resend', 5, 3600),
    validate({ body: v.emailOnlySchema }),
    rateLimit({ name: 'resend-email', max: 3, windowSeconds: 3600, key: byEmail }),
    c.resendConfirmation,
  );
  r.post(
    '/password/forgot',
    ipLimit('forgot', 5, 3600),
    validate({ body: v.emailOnlySchema }),
    rateLimit({ name: 'forgot-email', max: 3, windowSeconds: 3600, key: byEmail }),
    c.forgotPassword,
  );
  r.post('/password/reset', ipLimit('reset', 10, 3600), validate({ body: v.resetPasswordSchema }), c.resetPassword);
  r.post(
    '/password/change',
    authenticate(),
    requireAal2(),
    rateLimit({ name: 'change-password', max: 5, windowSeconds: 3600, key: byUser }),
    validate({ body: v.changePasswordSchema }),
    c.changePassword,
  );

  const mfaLimit = rateLimit({ name: 'mfa', max: 10, windowSeconds: 900, key: byUser });
  r.post('/mfa/enroll', authenticate(), mfaLimit, c.mfaEnroll);
  r.post('/mfa/verify', authenticate(), mfaLimit, validate({ body: v.mfaVerifySchema }), c.mfaVerifyEnrollment);
  r.post('/mfa/challenge', authenticate(), mfaLimit, validate({ body: v.mfaCodeSchema }), c.mfaChallenge);
  r.post('/mfa/disable', authenticate(), requireAal2(), mfaLimit, validate({ body: v.mfaCodeSchema }), c.mfaDisable);
  return r;
}
