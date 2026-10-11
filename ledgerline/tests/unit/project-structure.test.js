// Guards for the project rules: every page has its own HTML/CSS/JS, no
// framework, no HTML-string injection, CSP-safe markup, localStorage only for
// preferences, generated files up to date, translations complete.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SITE_ROUTES } from '../../server/config/site-routes.js';
import { vercelConfig } from '../../scripts/generate-vercel-config.js';
import { checkI18n } from '../../scripts/check-i18n.js';
import { walk } from '../../scripts/lib/i18n-scan.js';
import { localizeHtml, robotsTxt } from '../../scripts/lib/prerender.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const jsFiles = walk(path.join(ROOT, 'public/js'), '.js');
const htmlFiles = walk(path.join(ROOT, 'public/pages'), '.html');

test('every route has its own page HTML, page script and page stylesheet', () => {
  for (const route of SITE_ROUTES) {
    for (const file of [`public/pages/${route.page}.html`, `public/js/pages/${route.page}.js`, `public/css/pages/${route.page}.css`]) {
      assert.ok(existsSync(path.join(ROOT, file)), `missing ${file}`);
    }
    const html = read(`public/pages/${route.page}.html`);
    assert.match(html, new RegExp(`<script type="module" src="/js/pages/${route.page}\\.js"></script>`), route.page);
    assert.match(html, new RegExp(`href="/css/pages/${route.page}\\.css"`), route.page);
    assert.match(read(`public/js/pages/${route.page}.js`), /definePage\(/, route.page);
  }
});

test('no front-end framework or UI library is used', () => {
  const pkg = JSON.parse(read('package.json'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const forbidden = ['react', 'react-dom', 'vue', 'angular', '@angular/core', 'svelte', 'next', 'nuxt', 'vite', 'jquery', 'bootstrap', 'tailwindcss', 'preact', 'lit', 'solid-js'];
  assert.deepEqual(deps.filter((d) => forbidden.includes(d)), []);
  for (const file of [...jsFiles, ...htmlFiles]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /cdn\.jsdelivr|unpkg\.com|cdnjs|googleapis\.com\/css|tailwind/i, file);
  }
});

test('no HTML string injection or dynamic code in browser scripts', () => {
  const banned = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(|setTimeout\(\s*['"`]/;
  for (const file of jsFiles) assert.doesNotMatch(readFileSync(file, 'utf8'), banned, path.relative(ROOT, file));
});

test('pages contain no inline scripts, inline styles or event-handler attributes (CSP)', () => {
  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${file}: inline script`);
    assert.doesNotMatch(html, /<style[\s>]/, `${file}: inline style element`);
    assert.doesNotMatch(html, /\sstyle="/, `${file}: style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${file}: event handler attribute`);
  }
});

test('translated elements contain plain text only (safe pre-rendering)', () => {
  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-i18n="[^"]+"[^>]*>([\s\S]*?)<\/\1>/g)) {
      assert.doesNotMatch(m[2], /</, `${path.relative(ROOT, file)}: nested markup inside ${m[0].slice(0, 80)}`);
    }
  }
});

test('localStorage holds visual preferences only', () => {
  const allowed = ['public/js/core/storage.js', 'public/js/core/boot-theme.js'];
  for (const file of jsFiles) {
    const rel = path.relative(ROOT, file);
    if (allowed.includes(rel)) continue;
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\blocalStorage\.|\bsessionStorage\.|\bindexedDB\.|document\.cookie\s*=/, rel);
  }
  const allowedKeys = /const ALLOWED = new Set\(\[([^\]]*)\]\)/.exec(read('public/js/core/storage.js'))[1];
  assert.doesNotMatch(allowedKeys, /token|balance|amount|password|session|wallet|address/i);
});

test('no server secrets in browser code or committed configuration', () => {
  for (const file of [...jsFiles, ...htmlFiles, path.join(ROOT, 'vercel.json')]) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /SUPABASE_SECRET_KEY|service_role|sb_secret_|SUMSUB_SECRET|CRON_SECRET|LOCAL_JWT_SECRET/, file);
  }
});

test('vercel.json is generated from the route table', () => {
  const current = JSON.parse(read('vercel.json'));
  const expected = vercelConfig({ supabaseUrl: undefined });
  assert.deepEqual(current.rewrites, expected.rewrites);
  assert.deepEqual(current.crons, expected.crons);
  assert.deepEqual(current.functions, expected.functions);
});

test('translations are complete in English, Russian and Arabic', () => {
  const { errors } = checkI18n();
  assert.deepEqual(errors, []);
});

test('pre-rendering escapes translated text and sets language and direction', () => {
  const html = '<html lang="en" dir="ltr" data-title-key="x:title"><head><title>T · Ledgerline</title><meta name="description" content="d" data-i18n-attr="content:x:desc"></head><body><p data-i18n="x:p">Hello</p></body></html>';
  const out = localizeHtml(html, {
    locale: 'ar', dir: 'rtl', messages: { x: { title: 'عنوان', desc: 'وصف "مقتبس"', p: '<script>alert(1)</script>' } }, fallback: {},
    canonical: 'https://example.org/ar', alternates: [{ locale: 'en', href: 'https://example.org/' }],
  });
  assert.match(out, /<html lang="ar" dir="rtl"/);
  assert.match(out, /<title>عنوان · Ledgerline<\/title>/);
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(out, /content="وصف &quot;مقتبس&quot;"/);
  assert.match(out, /rel="canonical" href="https:\/\/example.org\/ar"/);
  const robots = robotsTxt(SITE_ROUTES, { baseUrl: 'https://example.org' });
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Disallow: \/dashboard/);
  assert.doesNotMatch(robots, /Disallow: \/faq/);
});
