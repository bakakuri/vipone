// Browser error reports (window.onerror / unhandledrejection). Logged as
// structured warnings; never stored with personal data.

import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../core/logger.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';

const body = z.object({
  message: z.string().max(500),
  source: z.string().max(300).optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  stack: z.string().max(4000).optional(),
  page: z.string().max(200).optional(),
  release: z.string().max(40).optional(),
});

export function clientErrorsRoutes() {
  const r = Router();
  r.post('/', rateLimit({ name: 'client-errors', max: 30, windowSeconds: 600 }), validate({ body }), (req, res) => {
    logger.warn('client_error', { ...req.body, userAgent: req.get('user-agent')?.slice(0, 200) });
    res.status(204).end();
  });
  return r;
}
