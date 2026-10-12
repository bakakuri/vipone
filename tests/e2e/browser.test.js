// End-to-end tests in a real browser (Chromium via Playwright) against the
// real server and database: languages and RTL, themes, phone layout, the
// registration -> email confirmation -> dashboard flow, live balance updates,
// the deposit page with a staff-published USDT BEP20 address, and a complete
// withdrawal to the user's own address with two-factor sign-in.
// Screenshots are written to test-results/screenshots/.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { totp } from '../../server/security/totp.js';
import { startTestApp } from '../helpers/test-app.js';
import {
  PASSWORD, depositFor, enableMfa, grantRoles, registerAndLogin, releaseHolds, seedAddressPool, uniqueEmail,
} from '../helpers/scenario.js';
import { resetRateLimits } from '../../server/middleware/rate-limit.js';

const BSC_ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-results/screenshots');
mkdirSync(SHOTS, { recursive: true });

let app;
let browser;
before(async () => {
  app = await startTestApp({}, { withSite: true });
  await seedAddressPool(app, 'TRON', 10);
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  await app?.close();
});

async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return { context, page, errors };
}

async function signIn(page, email, { secret } = {}) {
  await page.goto(`${app.baseUrl}/login`);
  await page.fill('#login-email', email);
  await page.fill('#login-password', PASSWORD);
  await page.click('button[type=submit]');
  if (secret) {
    await page.waitForSelector('.otp input');
    const step = Math.floor(Date.now() / 30000);
    while (Math.floor(Date.now() / 30000) === step) await page.waitForTimeout(250); // fresh code
    await page.locator('.otp input').first().fill('');
    await page.keyboard.type(totp(secret));
  }
  await page.waitForURL(/\/dashboard/, { waitUntil: 'load' });
}

async function skipTour(page) {
  const skip = page.locator('.tour-card .link-button');
  if (await skip.count()) await skip.click();
}

test('public pages render in English, Russian and Arabic (right-to-left)', async () => {
  const { context, page, errors } = await newPage();
  await page.goto(`${app.baseUrl}/`);
  await page.waitForSelector('.public-header');
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  assert.match(await page.textContent('h1'), /Deposit USDT/);
  await page.goto(`${app.baseUrl}/ru`);
  await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Инвестируйте'));
  assert.equal(await page.getAttribute('html', 'lang'), 'ru');
  await page.goto(`${app.baseUrl}/ar/how-it-works`);
  await page.waitForFunction(() => document.documentElement.dir === 'rtl');
  assert.equal(await page.getAttribute('html', 'lang'), 'ar');
  const align = await page.evaluate(() => getComputedStyle(document.querySelector('h1')).direction);
  assert.equal(align, 'rtl');
  await page.screenshot({ path: path.join(SHOTS, 'ar-how-it-works.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
});

test('theme switcher and language switcher work and are remembered', async () => {
  const { context, page, errors } = await newPage({ colorScheme: 'light' });
  await page.goto(`${app.baseUrl}/faq`);
  await page.waitForSelector('.public-header');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark', 'dark is the default theme');
  await page.click('.public-header__prefs .dropdown:nth-of-type(2) > button');
  await page.click('.dropdown__item:has-text("Light")');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  await page.reload();
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light', 'theme remembered before first paint');
  await page.screenshot({ path: path.join(SHOTS, 'faq-light.png') });
  await page.click('.public-header__prefs .dropdown:nth-of-type(1) > button');
  await page.click('.dropdown__item[lang="ru"]');
  await page.waitForURL(/\/ru\/faq$/);
  await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Вопросы'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('phone layout has no horizontal scrolling', async () => {
  const { context, page } = await newPage({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const user = await registerAndLogin(app);
  await depositFor(app, user.client, { amount: '75' });
  for (const p of ['/', '/how-it-works', '/products', '/register']) {
    await page.goto(`${app.baseUrl}${p}`);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${p} overflows by ${overflow}px`);
  }
  resetRateLimits();
  await signIn(page, user.email);
  for (const p of ['/dashboard', '/deposit', '/withdrawals', '/transactions', '/investments']) {
    await page.goto(`${app.baseUrl}${p}`);
    await page.waitForTimeout(600);
    await skipTour(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${p} overflows by ${overflow}px`);
  }
  await page.goto(`${app.baseUrl}/dashboard`);
  await page.waitForSelector('.ledger-strip');
  await skipTour(page);
  await page.screenshot({ path: path.join(SHOTS, 'mobile-dashboard.png'), fullPage: true });
  await context.close();
});

test('register -> confirm email -> dashboard, then a deposit appears live', async () => {
  resetRateLimits();
  const { context, page, errors } = await newPage();
  const email = uniqueEmail('e2e');
  await page.goto(`${app.baseUrl}/register`);
  await page.fill('#reg-email', email);
  await page.fill('#reg-password', PASSWORD);
  await page.selectOption('#reg-country', 'GE');
  for (const name of ['acceptTerms', 'acceptPrivacy', 'acceptRisk']) await page.check(`input[name="${name}"]`);
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Check your email');

  const mail = [...app.emails()].reverse().find((m) => m.to === email && /verify-email/.test(m.text));
  const link = /(http\S+verify-email\?token_hash=\S+)/.exec(mail.text)[1].replace(/^https?:\/\/[^/]+/, app.baseUrl);
  await page.goto(link);
  await page.waitForSelector('text=Email confirmed');
  await page.click('a[href="/dashboard"]');
  await page.waitForSelector('.ledger-strip');
  await page.waitForSelector('.quick-actions a[href="/deposit"]');
  await page.waitForSelector('.live-indicator[data-state="connected"]', { timeout: 10000 });
  const total = page.locator('.balance-card .stat__value');
  assert.match(await total.textContent(), /0\.00/);

  // The deposit arrives while the dashboard is open: the page updates itself.
  const client = app.client();
  await client.post('/api/v1/auth/login', { email, password: PASSWORD });
  await depositFor(app, client, { amount: '1000' });
  await page.waitForFunction(() => document.querySelector('.balance-card .stat__value')?.textContent.includes('1,000.00'), null, { timeout: 15000 });
  await page.waitForSelector('.inflight-item, .table td', { timeout: 5000 });
  await page.screenshot({ path: path.join(SHOTS, 'dashboard-after-deposit.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
});

test('deposit page shows the published USDT BEP20 address and takes an "I have sent it" report', async () => {
  resetRateLimits();
  const staff = await registerAndLogin(app);
  await grantRoles(app, staff.userId, ['finance', 'compliance']);
  const created = await staff.client.post('/api/v1/admin/deposits/methods', { asset: 'USDT', network: 'BSC', address: BSC_ADDRESS, minAmount: '10' });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const user = await registerAndLogin(app);
  const { context, page, errors } = await newPage();
  await signIn(page, user.email);
  await page.goto(`${app.baseUrl}/deposit`);
  await page.waitForSelector('.deposit-address__qr svg');
  assert.match(await page.textContent('.deposit-address'), new RegExp(BSC_ADDRESS));
  assert.match(await page.textContent('.deposit-warning'), /BEP20/);
  await page.fill('#man-amount', '250');
  await page.fill('#man-from', '0x8894E0a0c962CB723c1976a4421c95949bE2D4E3');
  await page.click('button:has-text("I have sent it")');
  await page.waitForSelector('text=Payment reported');
  await page.waitForSelector('td .badge:has-text("Being checked")');
  const [d] = await app.sql`select source, status, claimed_amount, from_address from app.deposits where user_id = ${user.userId}`;
  assert.equal(d.source, 'manual');
  assert.equal(d.status, 'under_review');
  assert.equal(d.claimed_amount, '250.000000000000000000');
  assert.equal(d.from_address, '0x8894E0a0c962CB723c1976a4421c95949bE2D4E3');
  const [b] = await app.sql`select count(*)::int as n from app.ledger_entries e join app.ledger_accounts a on a.id = e.account_id where a.user_id = ${user.userId}`;
  assert.equal(b.n, 0, 'a report never changes the balance');
  await page.screenshot({ path: path.join(SHOTS, 'deposit-manual.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
});

test('withdrawal to the user\'s own BEP20 address shows the server quote: 3% + network fee', async () => {
  resetRateLimits();
  const user = await registerAndLogin(app);
  await depositFor(app, user.client, { amount: '500' });
  await releaseHolds(app, user.userId);
  const secret = await enableMfa(user.client);
  // As on the production site: an address typed into the form is usable at once.
  await app.sql`update app.system_settings set value = '0'::jsonb where key = 'withdrawal.new_address_cooldown_hours'`;

  const { context, page, errors } = await newPage();
  await signIn(page, user.email, { secret });
  await page.goto(`${app.baseUrl}/withdrawals`);
  await page.waitForSelector('#wd-amount');
  const bep20 = page.locator('label.method-chip:has-text("BEP20")');
  if (await bep20.count()) await bep20.click();
  await page.fill('#wd-address', BSC_ADDRESS);
  await page.fill('#wd-amount', '100');
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('.fee-summary');
  const summary = await page.textContent('.fee-summary');
  assert.match(summary, /3\.00 USDT/);
  assert.match(summary, /1\.00 USDT/);
  assert.match(summary, /96\.00 USDT/);
  await page.screenshot({ path: path.join(SHOTS, 'withdrawal-quote.png'), fullPage: true });
  await page.click('button:has-text("Confirm withdrawal")');
  await page.waitForSelector('text=Withdrawal requested');
  await page.waitForSelector('td .badge[data-status="pending"]');
  const [w] = await app.sql`select amount, net_amount, status, address from app.withdrawal_requests where user_id = ${user.userId}`;
  assert.equal(w.status, 'pending');
  assert.equal(w.net_amount, '96.000000000000000000');
  assert.equal(w.address.toLowerCase(), BSC_ADDRESS.toLowerCase());
  assert.deepEqual(errors, []);
  await context.close();
});

test('staff see the admin area; customers are sent back to their dashboard', async () => {
  resetRateLimits();
  const staff = await registerAndLogin(app);
  await app.sql`insert into app.user_roles (user_id, role) values (${staff.userId}, 'super_admin')`;
  const { context, page, errors } = await newPage();
  await signIn(page, staff.email).catch(async () => page.waitForURL(/\/admin/));
  await page.goto(`${app.baseUrl}/admin`);
  await page.waitForSelector('text=Coverage by asset');
  await page.screenshot({ path: path.join(SHOTS, 'admin-overview.png'), fullPage: true });
  await page.goto(`${app.baseUrl}/admin/withdrawals`);
  await page.waitForSelector('.filter-bar');
  assert.deepEqual(errors, []);
  await context.close();

  const customer = await registerAndLogin(app);
  const c = await newPage();
  await signIn(c.page, customer.email);
  await c.page.goto(`${app.baseUrl}/admin/settings`);
  await c.page.waitForURL(/\/dashboard/);
  await c.context.close();
});
