// Local development server: the same Express app as production plus static
// files from public/ with the clean URLs defined in config/site-routes.js.
//   npm run dev  ->  http://localhost:3000

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.js';
import { getConfig } from './config/env.js';
import { DEFAULT_LOCALE, LOCALES, SITE_ROUTES, localizedPath, pageFile } from './config/site-routes.js';
import { robotsTxt, sitemapXml } from '../scripts/lib/prerender.js';
import { closeDb } from './db/client.js';
import { logger } from './core/logger.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

export function createDevServer() {
  return createApp({
    beforeApi(app) {
      // In production these are static files written by scripts/build.js.
      app.get('/robots.txt', (req, res) => res.type('text/plain').send(robotsTxt(SITE_ROUTES, { baseUrl: getConfig().appUrl })));
      app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(sitemapXml(SITE_ROUTES, {
        baseUrl: getConfig().appUrl, locales: LOCALES, defaultLocale: DEFAULT_LOCALE, localizedPath, lastmod: new Date().toISOString().slice(0, 10),
      })));
      for (const route of SITE_ROUTES) {
        const file = path.join(PUBLIC_DIR, pageFile(route));
        app.get(route.path, (req, res) => res.sendFile(file));
        if (route.localized) {
          for (const locale of LOCALES.filter((l) => l !== 'en')) {
            app.get(`/${locale}${route.path === '/' ? '' : route.path}`, (req, res) => res.sendFile(file));
          }
        }
      }
      app.use(express.static(PUBLIC_DIR, { index: false, extensions: false, maxAge: 0 }));
      app.use((req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.status(404).sendFile(path.join(PUBLIC_DIR, 'pages/404.html'));
      });
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = getConfig();
  const server = createDevServer().listen(config.port, () => {
    logger.info(`Ledgerline running at http://localhost:${config.port} (${config.mode} mode, auth: ${config.auth.provider})`);
  });
  const shutdown = () => server.close(() => closeDb().finally(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
