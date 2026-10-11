import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import * as c from './public.controller.js';

export function publicRoutes() {
  const r = Router();
  r.get('/config', c.config);
  r.get('/assets', c.assets);
  r.get('/products', c.products);
  r.get('/products/:slug', validate({ params: z.object({ slug: z.string().regex(/^[a-z0-9-]{3,60}$/) }) }), c.product);
  r.get('/legal', c.legal);
  r.get('/stats', c.stats);
  return r;
}
