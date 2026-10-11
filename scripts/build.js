#!/usr/bin/env node
// Production build for Vercel: public/ -> dist/
//   - copies every static file
//   - inlines the CSS @imports into one stylesheet (fewer requests)
//   - pre-renders the public pages in English, Russian and Arabic
//     (/ru/..., /ar/...) with canonical and hreflang links
//   - writes sitemap.xml and robots.txt from server/config/site-routes.js
//   - copies the 404 page to dist/404.html (served by Vercel for unknown URLs)
// The site's absolute URL comes from APP_URL (or, on Vercel, the production
// domain the platform provides).

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOCALE, LOCALES, SITE_ROUTES, localizedPath } from '../server/config/site-routes.js';
import { checkI18n, loadLocale } from './check-i18n.js';
import { normalizeUrl } from '../server/config/env.js';
import { flattenCss, localizeHtml, robotsTxt, sitemapXml } from './lib/prerender.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');
const DIR = { en: 'ltr', ru: 'ltr', ar: 'rtl' };

function siteUrl() {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return normalizeUrl(explicit);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return normalizeUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  return null;
}

export async function build({ outDir = OUT, log = console.log } = {}) {
  const { errors } = checkI18n();
  if (errors.length) throw new Error(`Translations are incomplete:\n${errors.slice(0, 20).join('\n')}`);

  const baseUrl = siteUrl();
  if (!baseUrl) log('warning: APP_URL is not set; canonical links and sitemap URLs are omitted.');

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(SRC, outDir, { recursive: true });

  const css = await flattenCss(path.join(SRC, 'css/app.css'), readFile, path);
  await writeFile(path.join(outDir, 'css/app.css'), `/* Built ${new Date().toISOString()} */\n${css}`);

  const messages = Object.fromEntries(LOCALES.map((l) => [l, loadLocale(l)]));
  let pages = 0;
  for (const route of SITE_ROUTES.filter((r) => r.localized)) {
    const source = await readFile(path.join(SRC, 'pages', `${route.page}.html`), 'utf8');
    const alternates = baseUrl ? LOCALES.map((l) => ({ locale: l, href: `${baseUrl}${localizedPath(route, l)}` })) : [];
    for (const locale of LOCALES) {
      const html = localizeHtml(source, {
        locale,
        dir: DIR[locale],
        messages: messages[locale],
        fallback: messages[DEFAULT_LOCALE],
        canonical: baseUrl ? `${baseUrl}${localizedPath(route, locale)}` : null,
        alternates,
      });
      const target = locale === DEFAULT_LOCALE
        ? path.join(outDir, 'pages', `${route.page}.html`)
        : path.join(outDir, 'pages', locale, `${route.page}.html`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, html);
      pages += 1;
    }
  }
  await cp(path.join(outDir, 'pages/404.html'), path.join(outDir, '404.html'));

  const lastmod = new Date().toISOString().slice(0, 10);
  if (baseUrl) {
    await writeFile(path.join(outDir, 'sitemap.xml'), sitemapXml(SITE_ROUTES, { baseUrl, locales: LOCALES, defaultLocale: DEFAULT_LOCALE, localizedPath, lastmod }));
  }
  await writeFile(path.join(outDir, 'robots.txt'), robotsTxt(SITE_ROUTES, { baseUrl }));
  log(`build complete: ${pages} pre-rendered pages, ${baseUrl ? 'sitemap.xml written' : 'no sitemap (APP_URL missing)'} -> ${path.relative(ROOT, outDir)}/`);
  return { pages, baseUrl };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
