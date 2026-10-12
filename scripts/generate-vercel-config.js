#!/usr/bin/env node
// Writes vercel.json from server/config/site-routes.js and
// server/config/security-headers.js, so page URLs and security headers have
// one source of truth. Run after changing routes: npm run vercel:config
// (a test fails if vercel.json is out of date).

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cspHeaderValue, STATIC_SECURITY_HEADERS } from '../server/config/security-headers.js';
import { DEFAULT_LOCALE, LOCALES, SITE_ROUTES, localizedPath } from '../server/config/site-routes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function vercelConfig({ supabaseUrl = process.env.SUPABASE_URL } = {}) {
  const rewrites = [{ source: '/api/:path*', destination: '/api' }];
  for (const route of SITE_ROUTES) {
    rewrites.push({ source: route.path, destination: `/pages/${route.page}.html` });
    if (route.localized) {
      for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
        rewrites.push({ source: localizedPath(route, locale), destination: `/pages/${locale}/${route.page}.html` });
      }
    }
  }
  const security = Object.entries({ ...STATIC_SECURITY_HEADERS, 'Content-Security-Policy': cspHeaderValue({ supabaseUrl }) })
    .map(([key, value]) => ({ key, value }));
  const privatePaths = SITE_ROUTES.filter((r) => r.access !== 'public').map((r) => r.path);
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    buildCommand: 'npm run build',
    outputDirectory: 'dist',
    cleanUrls: false,
    trailingSlash: false,
    functions: {
      'api/index.js': { maxDuration: 60, includeFiles: 'public/locales/**' },
    },
    rewrites,
    headers: [
      { source: '/(.*)', headers: security },
      { source: '/pages/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      { source: '/(css|js|locales|vendor)/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=300, must-revalidate' }] },
      { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      ...privatePaths.map((p) => ({ source: p, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'no-store' }] })),
    ],
    // Vercel Cron (Pro plan for 5-minute schedules; Hobby allows one run per day —
    // see docs/DEPLOYMENT.md for the Supabase pg_cron alternative).
    crons: [
      { path: '/api/v1/jobs/group/frequent', schedule: '*/5 * * * *' },
      { path: '/api/v1/jobs/group/daily', schedule: '0 3 * * *' },
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = vercelConfig();
  await writeFile(path.join(ROOT, 'vercel.json'), `${JSON.stringify(config, null, 2)}\n`);
  console.log(`vercel.json written: ${config.rewrites.length} rewrites, ${config.headers.length} header rules, ${config.crons.length} crons`);
}
