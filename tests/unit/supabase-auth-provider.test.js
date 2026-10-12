// Supabase Auth provider against a fake GoTrue: two-factor setup clears an
// unfinished earlier attempt, and Supabase's MFA error codes become clear
// application errors.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureLogger } from '../../server/core/logger.js';
import { createSupabaseAuthProvider } from '../../server/integrations/auth/supabase-auth-provider.js';

configureLogger({ quiet: true });

const config = { appName: 'Ledgerline', auth: { supabaseUrl: 'https://abc.supabase.co', publishableKey: 'sb_publishable_test' } };

function fakeGoTrue(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const key = `${init.method} ${new URL(url).pathname.replace('/auth/v1', '')}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null });
    const handler = routes[key] || routes[key.replace(/[0-9a-f-]{36}$/, ':id')];
    const [status, body] = handler ? handler() : [404, { error_code: 'not_found' }];
    return new Response(body === null ? '' : JSON.stringify(body), { status });
  };
  return { fetchImpl, calls };
}

test('two-factor setup removes an unfinished earlier factor and uses a unique name', async () => {
  const stale = '11111111-2222-3333-4444-555555555555';
  const { fetchImpl, calls } = fakeGoTrue({
    'GET /user': () => [200, { id: 'u1', factors: [{ id: stale, factor_type: 'totp', status: 'unverified' }] }],
    'DELETE /factors/:id': () => [200, { id: stale }],
    'POST /factors': () => [200, { id: 'f-new', totp: { secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Ledgerline:a@b.c?secret=JBSWY3DPEHPK3PXP' } }],
  });
  const provider = createSupabaseAuthProvider(config, { fetchImpl });
  const res = await provider.mfa.enroll('token', { friendlyName: 'Ledgerline authenticator', issuer: 'Ledgerline' });
  assert.equal(res.factorId, 'f-new');
  assert.equal(res.secret, 'JBSWY3DPEHPK3PXP');
  assert.deepEqual(calls.map((c) => c.key), ['GET /user', `DELETE /factors/${stale}`, 'POST /factors']);
  const body = calls[2].body;
  assert.equal(body.factor_type, 'totp');
  assert.equal(body.issuer, 'Ledgerline');
  assert.match(body.friendly_name, /^Ledgerline authenticator \S+$/);
});

test('an already verified authenticator is reported instead of failing', async () => {
  const { fetchImpl } = fakeGoTrue({ 'GET /user': () => [200, { id: 'u1', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] }] });
  const provider = createSupabaseAuthProvider(config, { fetchImpl });
  await assert.rejects(provider.mfa.enroll('token', { friendlyName: 'x' }), { code: 'mfa_already_enabled' });
});

test('MFA switched off in Supabase becomes a clear error', async () => {
  const { fetchImpl } = fakeGoTrue({
    'GET /user': () => [200, { id: 'u1', factors: [] }],
    'POST /factors': () => [422, { code: 422, error_code: 'mfa_totp_enroll_not_enabled', msg: 'MFA enroll is disabled for TOTP' }],
  });
  const provider = createSupabaseAuthProvider(config, { fetchImpl });
  await assert.rejects(provider.mfa.enroll('token', { friendlyName: 'x' }), { code: 'mfa_unavailable', status: 503 });
});
