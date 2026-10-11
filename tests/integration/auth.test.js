import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { resetRateLimits } from '../../server/middleware/rate-limit.js';
import { totp } from '../../server/security/totp.js';
import { startTestApp } from '../helpers/test-app.js';
import { PASSWORD, enableMfa, registerAndLogin, uniqueEmail } from '../helpers/scenario.js';

let app;
before(async () => {
  app = await startTestApp();
});
after(async () => {
  await app?.close();
});
beforeEach(() => resetRateLimits());

const base = (email, extra = {}) => ({ email, password: PASSWORD, locale: 'en', countryCode: 'GE', acceptTerms: true, acceptPrivacy: true, acceptRisk: true, ...extra });

test('registration validates input and legal consent on the server', async () => {
  const c = app.client();
  const weak = await c.post('/api/v1/auth/register', base(uniqueEmail(), { password: 'short' }));
  assert.equal(weak.status, 422);
  assert.ok(weak.error.details[0].rules.includes('length'));
  const noTerms = await c.post('/api/v1/auth/register', base(uniqueEmail(), { acceptTerms: false }));
  assert.equal(noTerms.status, 422);
  const blocked = await c.post('/api/v1/auth/register', base(uniqueEmail(), { countryCode: 'KP' }));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.error.code, 'country_not_supported');
  const badRef = await c.post('/api/v1/auth/register', base(uniqueEmail(), { referralCode: 'NOPE1234' }));
  assert.equal(badRef.error.code, 'referral_code_invalid');
});

test('duplicate registration gets the same answer (no account enumeration)', async () => {
  const email = uniqueEmail();
  const c = app.client();
  const first = await c.post('/api/v1/auth/register', base(email));
  const second = await c.post('/api/v1/auth/register', base(email));
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.deepEqual(first.data, second.data);
});

test('unconfirmed email cannot sign in; wrong password is generic', async () => {
  const email = uniqueEmail();
  const c = app.client();
  await c.post('/api/v1/auth/register', base(email));
  const unconfirmed = await c.post('/api/v1/auth/login', { email, password: PASSWORD });
  assert.equal(unconfirmed.status, 403);
  assert.equal(unconfirmed.error.code, 'email_not_confirmed');
  const wrong = await c.post('/api/v1/auth/login', { email: uniqueEmail(), password: PASSWORD });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.error.code, 'invalid_credentials');
});

test('session cookies are HttpOnly and state changes need the CSRF header', async () => {
  const { client, email } = await registerAndLogin(app);
  const res = await client.post('/api/v1/auth/login', { email, password: PASSWORD }, { raw: true });
  const cookies = res.headers.getSetCookie();
  const access = cookies.find((c) => c.startsWith('ll_at='));
  assert.match(access, /HttpOnly/);
  assert.match(access, /SameSite=Strict/);

  const noCsrf = await fetch(`${app.baseUrl}/api/v1/profile`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: client.cookieHeader(), origin: app.baseUrl },
    body: JSON.stringify({ theme: 'dark' }),
  });
  assert.equal(noCsrf.status, 403);
  const foreign = await fetch(`${app.baseUrl}/api/v1/profile`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: client.cookieHeader(), origin: 'https://evil.example', 'x-csrf-token': client.csrf() },
    body: JSON.stringify({ theme: 'dark' }),
  });
  assert.equal(foreign.status, 403);
  const ok = await client.patch('/api/v1/profile', { theme: 'dark' });
  assert.equal(ok.status, 200);
});

test('refresh tokens rotate; reusing an old one revokes the session family', async () => {
  const { client } = await registerAndLogin(app);
  const oldRefresh = client.cookies.get('ll_rt');
  const r1 = await client.post('/api/v1/auth/refresh', {});
  assert.equal(r1.status, 200);
  assert.notEqual(client.cookies.get('ll_rt'), oldRefresh);

  const attacker = app.client();
  attacker.cookies.set('ll_rt', oldRefresh);
  attacker.cookies.set('ll_csrf', 'x');
  const replay = await attacker.post('/api/v1/auth/refresh', {}, { headers: { 'x-csrf-token': 'x' } });
  assert.equal(replay.status, 401);
  const victim = await client.post('/api/v1/auth/refresh', {});
  assert.equal(victim.status, 401, 'family revoked after reuse');
});

test('two-factor: enrollment, sign-in challenge and step-up', async () => {
  const { client, email } = await registerAndLogin(app);
  const secret = await enableMfa(client);
  const fresh = app.client();
  const login = await fresh.post('/api/v1/auth/login', { email, password: PASSWORD });
  assert.equal(login.data.mfaRequired, true);
  const blocked = await fresh.post('/api/v1/auth/password/change', { currentPassword: PASSWORD, newPassword: 'Another-Strong-Pass-9' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.error.code, 'mfa_required');
  const bad = await fresh.post('/api/v1/auth/mfa/challenge', { code: '000000' });
  assert.equal(bad.status, 422);
  // Wait for the next 30-second step so the code differs from the one used at enrollment.
  const step = Math.floor(Date.now() / 30000);
  while (Math.floor(Date.now() / 30000) === step) await new Promise((r) => setTimeout(r, 250));
  const ok = await fresh.post('/api/v1/auth/mfa/challenge', { code: totp(secret) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.data.aal, 'aal2');
});

test('password reset by email link signs other sessions out', async () => {
  const { client, email } = await registerAndLogin(app);
  const c = app.client();
  const forgot = await c.post('/api/v1/auth/password/forgot', { email });
  assert.equal(forgot.status, 202);
  const unknown = await c.post('/api/v1/auth/password/forgot', { email: uniqueEmail() });
  assert.equal(unknown.status, 202, 'same answer for unknown emails');
  const mail = app.emails().filter((m) => m.to === email && /reset-password/.test(m.text)).pop();
  const token = decodeURIComponent(/token_hash=([^&\s]+)/.exec(mail.text)[1]);
  const reset = await c.post('/api/v1/auth/password/reset', { tokenHash: token, password: 'Brand-New-Password-7' });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  const reused = await c.post('/api/v1/auth/password/reset', { tokenHash: token, password: 'Brand-New-Password-8' });
  assert.equal(reused.status, 422);
  const old = await client.post('/api/v1/auth/refresh', {});
  assert.equal(old.status, 401, 'previous session signed out');
  const relogin = await app.client().post('/api/v1/auth/login', { email, password: 'Brand-New-Password-7' });
  assert.equal(relogin.status, 200);
  const notify = app.emails().filter((m) => m.to === email && /password was changed/i.test(m.subject));
  assert.equal(notify.length, 1);
});

test('login is rate limited per email', async () => {
  const email = uniqueEmail();
  let last;
  for (let i = 0; i < 10; i += 1) last = await app.client().post('/api/v1/auth/login', { email, password: 'Wrong-password-1!' });
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
});
