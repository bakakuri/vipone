// Configuration is forgiving about how URLs are typed, and strict about safety.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, normalizeUrl } from '../../server/config/env.js';

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@db.example.org:6543/postgres',
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  IP_HASH_SECRET: 'x'.repeat(40),
  CRON_SECRET: 'y'.repeat(40),
  EMAIL_FROM: 'Site <no-reply@site.org>',
};

test('normalizeUrl adds https and drops trailing slashes and spaces', () => {
  assert.equal(normalizeUrl('vipone.vercel.app'), 'https://vipone.vercel.app');
  assert.equal(normalizeUrl(' https://vipone.vercel.app/ '), 'https://vipone.vercel.app');
  assert.equal(normalizeUrl('http://localhost:3000'), 'http://localhost:3000');
});

test('APP_URL without a scheme is accepted', () => {
  const c = loadConfig({ ...base, APP_URL: 'vipone-abc.vercel.app/' });
  assert.equal(c.appUrl, 'https://vipone-abc.vercel.app');
  assert.deepEqual(c.allowedOrigins, ['https://vipone-abc.vercel.app']);
});

test('on Vercel the production domain is used when APP_URL is missing, and deployment URLs are allowed origins', () => {
  const c = loadConfig({ ...base, VERCEL_PROJECT_PRODUCTION_URL: 'vipone-abc.vercel.app', VERCEL_URL: 'vipone-git-x-team.vercel.app' });
  assert.equal(c.appUrl, 'https://vipone-abc.vercel.app');
  assert.deepEqual(c.allowedOrigins, ['https://vipone-abc.vercel.app', 'https://vipone-git-x-team.vercel.app']);
});

test('production still refuses to start without its secrets', () => {
  assert.throws(() => loadConfig({ ...base, APP_URL: 'site.org', CRON_SECRET: 'short' }), /CRON_SECRET/);
});

test('staff two-factor authentication is optional unless the owner requires it', () => {
  assert.equal(loadConfig({ ...base, APP_URL: 'site.org' }).staffMfaRequired, false);
  assert.equal(loadConfig({ ...base, APP_URL: 'site.org', STAFF_MFA_REQUIRED: 'true' }).staffMfaRequired, true);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development', AUTH_PROVIDER: 'supabase', APP_URL: 'http://localhost:3000', STAFF_MFA_REQUIRED: 'true' }).staffMfaRequired, false);
  const live = { ...base, APP_URL: 'site.org', APP_MODE: 'live', AUTH_PROVIDER: 'supabase', LEGAL_APPROVAL_CONFIRMED: 'true' };
  assert.equal(loadConfig(live).staffMfaRequired, false);
  assert.equal(loadConfig({ ...live, STAFF_MFA_REQUIRED: 'true' }).staffMfaRequired, true);
  assert.deepEqual(loadConfig(live).warnings.filter((w) => /two-factor/.test(w)), []);
});

test('live mode with manual operations needs only the legal confirmation, Supabase Auth and https', () => {
  const live = { ...base, APP_URL: 'site.org', APP_MODE: 'live', AUTH_PROVIDER: 'supabase', DEMO_TOOLS_ENABLED: 'true' };
  assert.throws(() => loadConfig(live), /LEGAL_APPROVAL_CONFIRMED/);
  const c = loadConfig({ ...live, LEGAL_APPROVAL_CONFIRMED: 'true' });
  assert.equal(c.isLive, true);
  assert.equal(c.demoToolsEnabled, false, 'demo tools never run with real money');
  assert.throws(() => loadConfig({ ...live, LEGAL_APPROVAL_CONFIRMED: 'true', APP_URL: 'http://site.org' }), /https/);
});
