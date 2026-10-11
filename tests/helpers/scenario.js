// Building blocks for integration scenarios.

import crypto from 'node:crypto';
import { signGeneric } from '../../server/integrations/blockchain/signatures.js';
import { totp } from '../../server/security/totp.js';
import { encodeBase58Check } from '../../server/utils/address-checksum.js';
import { resetRateLimits } from '../../server/middleware/rate-limit.js';

export const PASSWORD = 'Correct-Horse-42!';

export function tronAddress() {
  return encodeBase58Check(0x41, crypto.randomBytes(20));
}

export function evmAddress() {
  return `0x${crypto.randomBytes(20).toString('hex')}`;
}

export function txHash() {
  return crypto.randomBytes(32).toString('hex');
}

export function uniqueEmail(prefix = 'user') {
  return `${prefix}.${crypto.randomBytes(4).toString('hex')}@example.com`;
}

function linkToken(email, emails) {
  const message = [...emails()].reverse().find((m) => m.to === email && /token_hash=/.test(m.text));
  if (!message) throw new Error(`no confirmation email for ${email}`);
  return decodeURIComponent(/token_hash=([^&\s]+)/.exec(message.text)[1]);
}

export async function registerAndLogin(app, { email = uniqueEmail(), password = PASSWORD, referralCode, locale = 'en', countryCode = 'GE' } = {}) {
  // Tests create many accounts from one IP; the per-IP limits are tested separately.
  resetRateLimits();
  const client = app.client();
  await client.get('/api/v1/auth/session');
  const reg = await client.post('/api/v1/auth/register', {
    email, password, locale, countryCode, referralCode, acceptTerms: true, acceptPrivacy: true, acceptRisk: true,
  });
  if (reg.status !== 202) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
  const token = linkToken(email, app.emails);
  const verify = await client.post('/api/v1/auth/verify-email', { tokenHash: token, type: 'signup' });
  if (verify.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verify.body)}`);
  const [profile] = await app.sql`select id from app.profiles where lower(email) = ${email}`;
  return { client, email, password, userId: profile.id };
}

export async function grantRoles(app, userId, roles) {
  for (const role of roles) await app.sql`insert into app.user_roles (user_id, role) values (${userId}, ${role}) on conflict do nothing`;
}

export async function enableMfa(client) {
  const enroll = await client.post('/api/v1/auth/mfa/enroll', {});
  if (enroll.status !== 200) throw new Error(`mfa enroll failed: ${JSON.stringify(enroll.body)}`);
  const { factorId, secret } = enroll.data;
  const verify = await client.post('/api/v1/auth/mfa/verify', { factorId, code: totp(secret) });
  if (verify.status !== 200) throw new Error(`mfa verify failed: ${JSON.stringify(verify.body)}`);
  return secret;
}

export async function seedAddressPool(app, network = 'TRON', count = 5) {
  const make = network === 'TRON' ? tronAddress : evmAddress;
  for (let i = 0; i < count; i += 1) await app.sql`insert into app.deposit_address_pool (network_code, address) values (${network}, ${make()})`;
}

export async function sendChainEvents(app, events) {
  const body = JSON.stringify({ events });
  const res = await fetch(`${app.baseUrl}/api/v1/webhooks/blockchain/generic`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ledgerline-signature': signGeneric('test-webhook-secret', body) },
    body,
  });
  return { status: res.status, body: await res.json() };
}

// Full deposit through the signed webhook pipeline.
export async function depositFor(app, client, { asset = 'USDT', network = 'TRON', amount = '1000', confirmations = 25 } = {}) {
  const addr = await client.get(`/api/v1/deposits/address?network=${network}`);
  if (addr.status !== 200) throw new Error(`address failed: ${JSON.stringify(addr.body)}`);
  const hash = txHash();
  const res = await sendChainEvents(app, [{
    id: `evt-${hash}`, network, txHash: hash, logIndex: 0, toAddress: addr.data.address, memo: addr.data.memo,
    fromAddress: tronAddress(), asset, amount, confirmations,
  }]);
  if (res.status !== 200) throw new Error(`webhook failed: ${JSON.stringify(res.body)}`);
  return { txHash: hash, address: addr.data.address, result: res.body.data.results[0] };
}

// Skips the 7-day hold (tests only) so funds become withdrawable.
export async function releaseHolds(app, userId) {
  await app.sql`update app.fund_holds set unlock_at = now() - interval '1 second' where user_id = ${userId}`;
}

export async function addConfirmedWallet(app, client, { asset = 'USDT', network = 'TRON', address = tronAddress(), label = 'Main' } = {}) {
  const added = await client.post('/api/v1/wallets', { label, asset, network, address });
  if (added.status !== 201) throw new Error(`wallet add failed: ${JSON.stringify(added.body)}`);
  const confirmed = await client.post(`/api/v1/wallets/${added.data.id}/confirm`, { code: added.data.devCode });
  if (confirmed.status !== 200) throw new Error(`wallet confirm failed: ${JSON.stringify(confirmed.body)}`);
  await app.sql`update app.withdrawal_wallets set usable_from = now() - interval '1 second' where id = ${added.data.id}`;
  return confirmed.data;
}
