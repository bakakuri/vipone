// Express application (no network listener). Used by:
//   api/index.js       — the Vercel Function entry point
//   server/server.js   — local development server (also serves public/)
//   tests              — HTTP integration tests

import express from 'express';
import { getConfig } from './config/env.js';
import { configureLogger } from './core/logger.js';
import { cookieParser } from './middleware/cookies.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { rateLimit } from './middleware/rate-limit.js';
import { requestContextMiddleware } from './middleware/request-context.js';
import { noStore, permissionsPolicy, securityHeaders } from './middleware/security-headers.js';
import { apiRoutes } from './routes.js';

export function createApp({ beforeApi } = {}) {
  const config = getConfig();
  configureLogger({ level: config.logLevel, quiet: config.isTest });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);

  app.use(requestContextMiddleware());
  app.use(securityHeaders(config));
  app.use(permissionsPolicy());
  if (beforeApi) beforeApi(app);

  app.use('/api', noStore());
  // Deposit methods carry an uploaded QR image (a data URL of at most 700 kB);
  // everything else keeps the small default limit.
  app.use('/api/v1/admin/deposits/methods', express.json({ limit: '1mb' }));
  app.use(
    '/api',
    express.json({
      limit: '200kb',
      verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use('/api', cookieParser());
  app.use('/api', rateLimit({ name: 'api', max: 600, windowSeconds: 60 }));
  app.use('/api', csrfProtection());
  app.use('/api/v1', apiRoutes());
  app.use('/api', notFoundHandler());
  app.use(errorHandler());
  return app;
}
