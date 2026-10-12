// The production set-up: USDT on BEP20 only, no automatic deposits. A user
// reports a deposit that staff credit; a withdrawal is requested with a typed
// address and paid by staff, who record the payout hash.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApp } from '../helpers/test-app.js';
import { enableMfa, evmAddress, grantRoles, registerAndLogin, releaseHolds, txHash } from '../helpers/scenario.js';

let app;
let user;
let staff;
let method;

before(async () => {
  app = await startTestApp();
  // Same configuration as the manual-operations migration.
  await app.sql`update app.asset_networks set deposit_enabled = (asset_code = 'USDT' and network_code = 'BSC'), withdrawal_enabled = (asset_code = 'USDT' and network_code = 'BSC')`;
  await app.sql`update app.system_settings set value = 'false'::jsonb where key = 'deposits.automatic'`;
  await app.sql`update app.system_settings set value = '0'::jsonb where key = 'withdrawal.new_address_cooldown_hours'`;
  user = await registerAndLogin(app);
  staff = await registerAndLogin(app);
  await grantRoles(app, staff.userId, ['finance', 'compliance']);
  method = (await staff.client.post('/api/v1/admin/deposits/methods', { asset: 'USDT', network: 'BSC', address: evmAddress(), minAmount: '10' })).data;
});
after(async () => {
  await app?.close();
});

const balance = async () => (await user.client.get('/api/v1/dashboard')).data.balances.find((b) => b.asset === 'USDT');

test('automatic deposit addresses are switched off', async () => {
  const res = await user.client.get('/api/v1/deposits/address?network=BSC');
  assert.equal(res.status, 409);
  assert.equal(res.error.code, 'feature_unavailable');
  const methods = (await user.client.get('/api/v1/deposits/methods')).data.methods;
  assert.deepEqual(methods.map((m) => m.network), ['BSC']);
});

test('a reported deposit names the sending wallet and is credited by staff', async () => {
  const from = evmAddress();
  const reported = await user.client.post('/api/v1/deposits/manual', { methodId: method.id, amount: '500', fromAddress: from }, { idempotencyKey: true });
  assert.equal(reported.status, 201, JSON.stringify(reported.body));
  const detail = (await staff.client.get(`/api/v1/admin/deposits/${reported.data.id}`)).data;
  assert.equal(detail.fromAddress, from);
  assert.equal(detail.email, user.email, 'staff see who reported the payment');
  const credited = await staff.client.post(`/api/v1/admin/deposits/${reported.data.id}/approve-manual`, { txHash: txHash(), reason: 'Checked on BscScan' });
  assert.equal(credited.data.status, 'credited');
  assert.equal((await balance()).available, '500');
  await releaseHolds(app, user.userId);
});

test('a withdrawal to a typed BEP20 address goes to staff, who pay it and record the hash', async () => {
  await enableMfa(user.client);
  const bad = await user.client.post('/api/v1/withdrawals/quote', { asset: 'USDT', network: 'BSC', address: 'not-an-address', amount: '100' });
  assert.equal(bad.status, 422);
  const tron = await user.client.post('/api/v1/withdrawals/quote', { asset: 'USDT', network: 'TRON', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: '100' });
  assert.equal(tron.status, 422, 'only BEP20 is offered');

  const address = evmAddress();
  const quote = await user.client.post('/api/v1/withdrawals/quote', { asset: 'USDT', network: 'BSC', address, amount: '100' });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.data.platformFee, '3');
  assert.equal(quote.data.networkFee, '1');
  assert.equal(quote.data.netAmount, '96');
  const again = await user.client.post('/api/v1/withdrawals/quote', { asset: 'USDT', network: 'BSC', address: address.toLowerCase(), amount: '50' });
  assert.equal(again.data.walletId, quote.data.walletId, 'the same address is reused, not saved twice');

  const request = await user.client.post('/api/v1/withdrawals', { quoteId: quote.data.id }, { idempotencyKey: true });
  assert.equal(request.status, 201, JSON.stringify(request.body));
  assert.equal(request.data.status, 'pending');
  assert.equal((await balance()).available, '400', 'the amount is reserved');

  const queue = (await staff.client.get('/api/v1/admin/withdrawals?status=pending')).data.items;
  assert.ok(queue.some((w) => w.id === request.data.id && w.address === address));

  const noHash = await staff.client.post(`/api/v1/admin/withdrawals/${request.data.id}/pay`, {});
  assert.equal(noHash.status, 422);
  const hash = txHash();
  const paid = await staff.client.post(`/api/v1/admin/withdrawals/${request.data.id}/pay`, { txHash: hash });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.data.status, 'completed');
  assert.equal(paid.data.txHash, hash);
  const mine = (await user.client.get(`/api/v1/withdrawals/${request.data.id}`)).data;
  assert.equal(mine.status, 'completed');
  assert.ok(app.emails().some((m) => m.to === user.email && /sent/i.test(m.subject)));

  const issues = await app.sql`select * from app.verify_ledger_integrity()`;
  assert.equal(issues.length, 0);
});

test('a rejected withdrawal returns the reserved amount', async () => {
  const quote = await user.client.post('/api/v1/withdrawals/quote', { asset: 'USDT', network: 'BSC', address: evmAddress(), amount: '40' });
  const request = await user.client.post('/api/v1/withdrawals', { quoteId: quote.data.id }, { idempotencyKey: true });
  const before = (await balance()).available;
  const rejected = await staff.client.post(`/api/v1/admin/withdrawals/${request.data.id}/reject`, { reason: 'Address belongs to a sanctioned service' });
  assert.equal(rejected.data.status, 'rejected');
  assert.equal(Number((await balance()).available), Number(before) + 40);
});

test('a large withdrawal needs two different approvers before it can be paid', async () => {
  const staff2 = await registerAndLogin(app);
  await grantRoles(app, staff2.userId, ['finance']);
  const reported = await user.client.post('/api/v1/deposits/manual', { methodId: method.id, amount: '12000' }, { idempotencyKey: true });
  await staff.client.post(`/api/v1/admin/deposits/${reported.data.id}/approve-manual`, { txHash: txHash(), reason: 'Checked on BscScan' });
  await releaseHolds(app, user.userId);

  const quote = await user.client.post('/api/v1/withdrawals/quote', { asset: 'USDT', network: 'BSC', address: evmAddress(), amount: '11000' });
  const request = await user.client.post('/api/v1/withdrawals', { quoteId: quote.data.id }, { idempotencyKey: true });
  assert.equal(request.status, 201, JSON.stringify(request.body));
  const id = request.data.id;
  assert.equal((await staff.client.get(`/api/v1/admin/withdrawals/${id}`)).data.requiresDualApproval, true);

  const first = await staff.client.post(`/api/v1/admin/withdrawals/${id}/approve`, {});
  assert.equal(first.data.statusReason, 'awaiting_second_approval');
  const samePerson = await staff.client.post(`/api/v1/admin/withdrawals/${id}/pay`, { txHash: txHash() });
  assert.notEqual(samePerson.status, 200, 'the first approver cannot complete it alone');
  assert.equal((await staff.client.get(`/api/v1/admin/withdrawals/${id}`)).data.status, 'under_review');

  const second = await staff2.client.post(`/api/v1/admin/withdrawals/${id}/approve`, {});
  assert.equal(second.data.status, 'approved');
  const paid = await staff.client.post(`/api/v1/admin/withdrawals/${id}/pay`, { txHash: txHash() });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.data.status, 'completed');
  const issues = await app.sql`select * from app.verify_ledger_integrity()`;
  assert.equal(issues.length, 0);
});
