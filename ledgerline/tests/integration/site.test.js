// The site as a browser sees it: every page URL (and its /ru, /ar versions)
// returns the page with security headers; robots.txt and sitemap.xml; the
// public configuration and asset list; no-store on API responses.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { LOCALES, SITE_ROUTES, localizedPath } from '../../server/config/site-routes.js';
import { startTestApp } from '../helpers/test-app.js';
import { registerAndLogin, depositFor, seedAddressPool } from '../helpers/scenario.js';

let app;
before(async () => {
  app = await startTestApp({}, { withSite: true });
});
after(async () => {
  await app?.close();
});

test('every page URL serves its HTML with a strict Content-Security-Policy', async () => {
  for (const route of SITE_ROUTES) {
    const urls = route.localized ? LOCALES.map((l) => localizedPath(route, l)) : [route.path];
    for (const url of urls) {
      const res = await fetch(`${app.baseUrl}${url}`);
      assert.equal(res.status, 200, url);
      assert.match(res.headers.get('content-type'), /text\/html/, url);
      const csp = res.headers.get('content-security-policy');
      assert.match(csp, /script-src 'self'/, url);
      assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/, url);
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      const html = await res.text();
      assert.match(html, new RegExp(`/js/pages/${route.page}\\.js`), url);
    }
  }
});

test('unknown pages return the 404 page; unknown API routes return JSON', async () => {
  const page = await fetch(`${app.baseUrl}/no-such-page`);
  assert.equal(page.status, 404);
  assert.match(await page.text(), /not-found\.js/);
  const api = await fetch(`${app.baseUrl}/api/v1/no-such-route`);
  assert.equal(api.status, 404);
  assert.equal((await api.json()).error.code, 'route_not_found');
});

test('robots.txt keeps private areas out of search engines; sitemap lists localized pages', async () => {
  const robots = await (await fetch(`${app.baseUrl}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Sitemap: /);
  const sitemap = await (await fetch(`${app.baseUrl}/sitemap.xml`)).text();
  assert.match(sitemap, /<loc>[^<]*\/ar\/how-it-works<\/loc>/);
  assert.match(sitemap, /hreflang="ru"/);
  assert.doesNotMatch(sitemap, /\/dashboard|\/admin/);
});

test('public configuration exposes no secrets and marks demo mode', async () => {
  const res = await fetch(`${app.baseUrl}/api/v1/public/config`);
  const { data } = await res.json();
  const session = await fetch(`${app.baseUrl}/api/v1/auth/session`);
  assert.equal(session.headers.get('cache-control'), 'no-store', 'account responses are never cached');
  assert.equal(data.mode, 'demo');
  assert.equal(JSON.stringify(data).match(/secret|key/i), null);
  const assets = (await (await fetch(`${app.baseUrl}/api/v1/public/assets`)).json()).data;
  assert.ok(assets.find((a) => a.code === 'USDT').networks.some((n) => n.code === 'TRON'));
  const stats = (await (await fetch(`${app.baseUrl}/api/v1/public/stats`)).json()).data;
  assert.equal(stats.available, false, 'no statistics in demo mode');
});

test('dashboard and earnings figures come from the ledger as exact strings', async () => {
  await seedAddressPool(app, 'TRON', 2);
  const user = await registerAndLogin(app);
  await depositFor(app, user.client, { amount: '250.5' });
  const dash = (await user.client.get('/api/v1/dashboard')).data;
  const usdt = dash.balances.find((b) => b.asset === 'USDT');
  assert.equal(usdt.total, '250.5');
  assert.equal(usdt.depositHold, '250.5');
  assert.equal(usdt.withdrawable, '0');
  assert.equal(dash.holds[0].amount, '250.5');
  const summary = (await user.client.get('/api/v1/earnings/summary')).data;
  const row = summary.perAsset.find((r) => r.asset === 'USDT');
  assert.equal(row.realisedNet, '0');
  const history = (await user.client.get('/api/v1/dashboard/history?asset=USDT&days=7')).data;
  assert.equal(history.points.length, 7);
  assert.match(history.points.at(-1).day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(history.points.at(-1).balance, '250.5');
});
