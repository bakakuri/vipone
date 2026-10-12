// Deposit methods published by staff and payments reported by users: a report
// never changes a balance; staff credit it once, with the checked amount and a
// transaction hash that can be used only once.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApp } from '../helpers/test-app.js';
import { grantRoles, registerAndLogin, txHash } from '../helpers/scenario.js';

let app;
let user;
let staff;
let method;

const ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

before(async () => {
  app = await startTestApp();
  user = await registerAndLogin(app);
  staff = await registerAndLogin(app);
  await grantRoles(app, staff.userId, ['finance', 'compliance']);
});
after(async () => {
  await app?.close();
});

const balance = async () => (await user.client.get('/api/v1/dashboard')).data.balances.find((b) => b.asset === 'USDT');
const report = (body) => user.client.post('/api/v1/deposits/manual', body, { idempotencyKey: true });

test('only staff with the permission can publish a deposit method', async () => {
  const denied = await user.client.post('/api/v1/admin/deposits/methods', { asset: 'USDT', network: 'TRON', address: ADDRESS });
  assert.equal(denied.status, 403);

  const created = await staff.client.post('/api/v1/admin/deposits/methods', {
    asset: 'USDT', network: 'TRON', label: 'Main wallet', address: ADDRESS, qrImage: PNG, minAmount: '10',
    instructions: { en: 'Send USDT on TRON.\nKeep the transaction ID.', ru: 'Отправьте USDT в сети TRON.', ar: '' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  method = created.data;
  assert.equal(method.qrImage, PNG);
  assert.deepEqual(method.instructions, { en: 'Send USDT on TRON.\nKeep the transaction ID.', ru: 'Отправьте USDT в сети TRON.' });

  const duplicate = await staff.client.post('/api/v1/admin/deposits/methods', { asset: 'USDT', network: 'TRON', address: ADDRESS });
  assert.equal(duplicate.status, 409);

  const badImage = await staff.client.post('/api/v1/admin/deposits/methods', { asset: 'USDC', network: 'ETHEREUM', address: '0x52908400098527886E0F7030069857D2E4169EE7', qrImage: 'data:text/html;base64,PHNjcmlwdD4=' });
  assert.equal(badImage.status, 422);

  const [{ count }] = await app.sql`select count(*)::int from app.audit_logs where action = 'deposit_method.created'`;
  assert.equal(count, 1);
});

test('users see active methods and the page notice', async () => {
  const notice = await staff.client.post('/api/v1/admin/settings/deposits.page_notice', { value: { en: 'Deposits are checked within 1 hour.' }, reason: 'Set deposit notice' });
  assert.equal(notice.status, 200, JSON.stringify(notice.body));
  const res = await user.client.get('/api/v1/deposits/methods');
  assert.equal(res.status, 200);
  assert.equal(res.data.methods.length, 1);
  assert.equal(res.data.methods[0].address, ADDRESS);
  assert.equal(res.data.notice.en, 'Deposits are checked within 1 hour.');
});

test('a reported payment changes no balance until staff credit it', async () => {
  const noKey = await user.client.post('/api/v1/deposits/manual', { methodId: method.id, amount: '250' });
  assert.equal(noKey.status, 428);

  const small = await report({ methodId: method.id, amount: '5' });
  assert.equal(small.status, 422);
  assert.equal(small.error.code, 'amount_below_minimum');

  const reported = await report({ methodId: method.id, amount: '250', note: 'From my exchange' });
  assert.equal(reported.status, 201, JSON.stringify(reported.body));
  assert.equal(reported.data.status, 'under_review');
  assert.equal(reported.data.source, 'manual');
  assert.equal(reported.data.claimedAmount, '250');
  assert.equal((await balance()).available, '0');

  // A hash is needed to credit; the generic "approve" is refused for reports.
  const noHash = await staff.client.post(`/api/v1/admin/deposits/${reported.data.id}/approve-manual`, { reason: 'Checked on Tronscan' });
  assert.equal(noHash.status, 422);
  assert.equal(noHash.error.code, 'tx_hash_required');
  const generic = await staff.client.post(`/api/v1/admin/deposits/${reported.data.id}/review`, { decision: 'approve', reason: 'Looks fine' });
  assert.equal(generic.status, 409);

  // Staff credit the amount that actually arrived.
  const hash = txHash();
  const approved = await staff.client.post(`/api/v1/admin/deposits/${reported.data.id}/approve-manual`, { amount: '240', txHash: hash, reason: 'Found on Tronscan, 240 USDT arrived' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.data.status, 'credited');
  assert.equal(approved.data.amount, '240');
  assert.equal((await balance()).available, '240');
  const [hold] = await app.sql`select amount from app.fund_holds where reference_id = ${reported.data.id}`;
  assert.equal(Number(hold.amount), 240, 'the 7-day deposit hold applies');

  // Approving twice, or crediting the same transaction again, is impossible.
  const again = await staff.client.post(`/api/v1/admin/deposits/${reported.data.id}/approve-manual`, { txHash: hash, reason: 'Second try' });
  assert.equal(again.status, 409);
  const reuse = await report({ methodId: method.id, amount: '240', txHash: hash });
  assert.equal(reuse.status, 409);
  assert.equal(reuse.error.code, 'duplicate_transaction');
  const other = await report({ methodId: method.id, amount: '30' });
  const reuseByStaff = await staff.client.post(`/api/v1/admin/deposits/${other.data.id}/approve-manual`, { txHash: hash, reason: 'Wrong hash' });
  assert.equal(reuseByStaff.status, 409);

  const [{ count }] = await app.sql`select count(*)::int from app.ledger_transactions where tx_type = 'deposit'`;
  assert.equal(count, 1);
  const issues = await app.sql`select * from app.verify_ledger_integrity()`;
  assert.equal(issues.length, 0);
});

test('a rejected report posts nothing to the ledger', async () => {
  const reported = await report({ methodId: method.id, amount: '99', txHash: txHash() });
  const rejected = await staff.client.post(`/api/v1/admin/deposits/${reported.data.id}/review`, { decision: 'reject', reason: 'No such transaction on chain' });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.data.status, 'rejected');
  assert.equal((await balance()).available, '240');
  const [{ count }] = await app.sql`select count(*)::int from app.ledger_transactions where reference_id = ${reported.data.id}`;
  assert.equal(count, 0);
});

test('open reports are capped and other users cannot see them', async () => {
  const [{ open }] = await app.sql`select count(*)::int as open from app.deposits where user_id = ${user.userId} and source = 'manual' and status = 'under_review'`;
  for (let i = open; i < 5; i += 1) assert.equal((await report({ methodId: method.id, amount: '11' })).status, 201);
  const sixth = await report({ methodId: method.id, amount: '11' });
  assert.equal(sixth.status, 409);
  assert.equal(sixth.error.code, 'too_many_pending');

  const stranger = await registerAndLogin(app);
  const mine = (await user.client.get('/api/v1/deposits')).data.items;
  const peek = await stranger.client.get(`/api/v1/deposits/${mine[0].id}`);
  assert.equal(peek.status, 404);
});

test('editing keeps the image unless replaced; a used method is hidden, not deleted', async () => {
  const edited = await staff.client.patch(`/api/v1/admin/deposits/methods/${method.id}`, { asset: 'USDT', network: 'TRON', address: ADDRESS, label: 'Cold wallet', isActive: true });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.data.label, 'Cold wallet');
  assert.equal(edited.data.qrImage, PNG);

  const removed = await staff.client.del(`/api/v1/admin/deposits/methods/${method.id}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.data.deactivated, true);
  const list = await user.client.get('/api/v1/deposits/methods');
  assert.equal(list.data.methods.length, 0);
  const closed = await report({ methodId: method.id, amount: '20' });
  assert.equal(closed.status, 409);
  assert.equal(closed.error.code, 'deposit_method_unavailable');
});
