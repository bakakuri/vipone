import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApp } from '../helpers/test-app.js';
import { grantRoles, registerAndLogin, seedAddressPool, sendChainEvents, tronAddress, txHash } from '../helpers/scenario.js';

let app;
let user;
let compliance;
let address;

before(async () => {
  app = await startTestApp();
  await seedAddressPool(app, 'TRON', 5);
  user = await registerAndLogin(app);
  compliance = await registerAndLogin(app);
  await grantRoles(app, compliance.userId, ['compliance', 'finance']);
  address = (await user.client.get('/api/v1/deposits/address?network=TRON')).data;
});
after(async () => {
  await app?.close();
});

const event = (overrides = {}) => ({
  id: `evt-${txHash().slice(0, 16)}`, network: 'TRON', txHash: txHash(), logIndex: 0, toAddress: address.address,
  fromAddress: tronAddress(), asset: 'USDT', amount: '300', confirmations: 0, blockNumber: 100, ...overrides,
});
const balance = async () => (await user.client.get('/api/v1/dashboard')).data.balances.find((b) => b.asset === 'USDT');

test('the same address is returned on every request', async () => {
  const again = await user.client.get('/api/v1/deposits/address?network=TRON');
  assert.equal(again.data.address, address.address);
  assert.equal(again.data.requiredConfirmations, 20);
});

test('unsigned or tampered webhooks are rejected', async () => {
  const body = JSON.stringify({ events: [event()] });
  const res = await fetch(`${app.baseUrl}/api/v1/webhooks/blockchain/generic`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-ledgerline-signature': 't=1,v1=00' }, body,
  });
  assert.equal(res.status, 401);
  assert.equal((await balance()).available, '0');
});

test('a deposit is credited only after the required confirmations', async () => {
  const e = event({ amount: '300' });
  const r1 = await sendChainEvents(app, [e]);
  assert.equal(r1.body.data.results[0].status, 'detected');
  const r2 = await sendChainEvents(app, [{ ...e, id: `${e.id}-5`, confirmations: 5 }]);
  assert.equal(r2.body.data.results[0].status, 'confirming');
  assert.equal((await balance()).available, '0', 'not spendable while confirming');
  const r3 = await sendChainEvents(app, [{ ...e, id: `${e.id}-20`, confirmations: 20 }]);
  assert.equal(r3.body.data.results[0].status, 'credited');
  assert.equal((await balance()).available, '300');

  // Replays of any delivery change nothing.
  await sendChainEvents(app, [{ ...e, id: `${e.id}-20`, confirmations: 20 }]);
  await sendChainEvents(app, [{ ...e, id: `${e.id}-21`, confirmations: 21 }]);
  assert.equal((await balance()).available, '300');
  const [{ count }] = await app.sql`select count(*)::int from app.ledger_transactions where tx_type = 'deposit'`;
  assert.equal(count, 1);
});

test('a reorg before crediting fails the deposit', async () => {
  const e = event({ amount: '50', confirmations: 3 });
  await sendChainEvents(app, [e]);
  const r = await sendChainEvents(app, [{ ...e, id: `${e.id}-reorg`, reorged: true }]);
  assert.equal(r.body.data.results[0].status, 'failed');
  assert.equal((await balance()).available, '300');
});

test('below-minimum deposits go to review; approval credits, rejection holds for return', async () => {
  const small = event({ amount: '5', confirmations: 25 });
  const r = await sendChainEvents(app, [small]);
  assert.equal(r.body.data.results[0].status, 'under_review');
  const depositId = r.body.data.results[0].depositId;
  const approved = await compliance.client.post(`/api/v1/admin/deposits/${depositId}/review`, { decision: 'approve', reason: 'Accepted small deposit' });
  assert.equal(approved.data.status, 'credited');
  assert.equal((await balance()).available, '305');

  const other = event({ amount: '4', confirmations: 25 });
  const r2 = await sendChainEvents(app, [other]);
  const rejected = await compliance.client.post(`/api/v1/admin/deposits/${r2.body.data.results[0].depositId}/review`, { decision: 'reject', reason: 'Below minimum, return to sender' });
  assert.equal(rejected.data.status, 'rejected');
  assert.equal((await balance()).available, '305');
  const [suspense] = await app.sql`
    select b.balance from app.ledger_balances b join app.ledger_accounts a on a.id = b.account_id
    where a.owner_type = 'system' and a.asset_code = 'USDT' and a.account_type = 'suspense'`;
  assert.equal(Number(suspense.balance), 4);
  const returned = await compliance.client.post(`/api/v1/admin/deposits/${r2.body.data.results[0].depositId}/return`, { txHash: txHash() });
  assert.equal(returned.status, 200);
});

test('events for unknown addresses never credit anyone', async () => {
  const r = await sendChainEvents(app, [event({ toAddress: tronAddress(), confirmations: 30 })]);
  assert.equal(r.body.data.results[0].outcome, 'unknown_address');
});

test('deposit requests expire, and the history is per user', async () => {
  const req = await user.client.post('/api/v1/deposits/requests', { asset: 'USDT', network: 'TRON', expectedAmount: '100' }, { idempotencyKey: true });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal(req.data.status, 'awaiting_payment');
  await app.sql`update app.deposits set expires_at = now() - interval '1 second' where id = ${req.data.id}`;
  await fetch(`${app.baseUrl}/api/v1/jobs/expire-deposit-requests`, { headers: { authorization: 'Bearer test-cron-secret-0123456789abcdef0123' } });
  const after = await user.client.get(`/api/v1/deposits/${req.data.id}`);
  assert.equal(after.data.status, 'failed');
  const other = await registerAndLogin(app);
  const peek = await other.client.get(`/api/v1/deposits/${req.data.id}`);
  assert.equal(peek.status, 404);
});
