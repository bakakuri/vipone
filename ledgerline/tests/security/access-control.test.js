// Authorisation, RLS, immutability and approval rules.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import postgres from 'postgres';
import { startTestApp } from '../helpers/test-app.js';
import { depositFor, grantRoles, registerAndLogin, seedAddressPool } from '../helpers/scenario.js';

let app;
let alice;
let bob;
let admin;
let admin2;

before(async () => {
  app = await startTestApp();
  await seedAddressPool(app, 'TRON', 5);
  alice = await registerAndLogin(app);
  bob = await registerAndLogin(app);
  admin = await registerAndLogin(app);
  admin2 = await registerAndLogin(app);
  await grantRoles(app, admin.userId, ['super_admin']);
  await grantRoles(app, admin2.userId, ['super_admin']);
  await depositFor(app, alice.client, { amount: '100' });
});
after(async () => {
  await app?.close();
});

test('users never see each other\'s data through the API', async () => {
  const deposits = await alice.client.get('/api/v1/deposits');
  const id = deposits.data.items[0].id;
  assert.equal((await bob.client.get(`/api/v1/deposits/${id}`)).status, 404);
  const tx = await alice.client.get('/api/v1/transactions');
  const ledgerId = tx.data.items[0].ledgerTransactionId;
  assert.equal((await bob.client.get(`/api/v1/transactions/${ledgerId}`)).status, 404);
  assert.equal((await alice.client.get(`/api/v1/transactions/${ledgerId}`)).status, 200);
});

test('every admin route requires a staff role', async () => {
  for (const path of ['/api/v1/admin/dashboard', '/api/v1/admin/users', '/api/v1/admin/settings', '/api/v1/admin/treasury', '/api/v1/admin/audit']) {
    assert.equal((await alice.client.get(path)).status, 403, path);
  }
  assert.equal((await app.client().get('/api/v1/admin/dashboard')).status, 401);
  assert.equal((await admin.client.get('/api/v1/admin/dashboard')).status, 200);
});

test('financial values cannot be changed through request parameters', async () => {
  const res = await alice.client.patch('/api/v1/profile', { theme: 'dark', balance: '1000000', status: 'active', kycStatus: 'approved' });
  assert.equal(res.status, 200);
  const [p] = await app.sql`select kyc_status from app.profiles where id = ${alice.userId}`;
  assert.equal(p.kyc_status, 'none');
  const q = await alice.client.post('/api/v1/withdrawals/quote', { walletId: '00000000-0000-0000-0000-000000000000', amount: '1e9' });
  assert.equal(q.status, 422);
});

test('RLS: a user JWT can read only its own rows and write nothing', async () => {
  const sql = postgres(app.config.db.url, { max: 1, onnotice: () => {} });
  try {
    const asUser = async (userId, fn) =>
      sql.begin(async (tx) => {
        await tx.unsafe(`set local role authenticated`);
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
        return fn(tx);
      });
    const own = await asUser(alice.userId, (tx) => tx`select id from app.deposits`);
    const other = await asUser(bob.userId, (tx) => tx`select id from app.deposits`);
    assert.equal(own.length, 1);
    assert.equal(other.length, 0);
    const ledger = await asUser(bob.userId, (tx) => tx`select id from app.ledger_entries`);
    assert.equal(ledger.length, 0);
    await assert.rejects(
      asUser(alice.userId, (tx) => tx`update app.ledger_balances set balance = 999999`),
      /permission denied/,
    );
    await assert.rejects(
      asUser(alice.userId, (tx) => tx`insert into app.notifications (user_id, type) values (${alice.userId}, 'announcement')`),
      /permission denied|row-level security/,
    );
    const staffView = await asUser(admin.userId, (tx) => tx`select id from app.deposits`);
    assert.equal(staffView.length, 1);
  } finally {
    await sql.end();
  }
});

test('ledger rows are append-only even for the database owner', async () => {
  await assert.rejects(app.sql`update app.ledger_entries set amount = amount + 1`, /immutable_record/);
  await assert.rejects(app.sql`delete from app.ledger_transactions`, /immutable_record/);
  await assert.rejects(app.sql`update app.ledger_balances set balance = 1`, /immutable_record/);
  await app.sql`insert into app.audit_logs (action, entity_type) values ('test.event', 'test')`;
  await assert.rejects(app.sql`delete from app.audit_logs`, /immutable_record/);
  await assert.rejects(app.sql`truncate app.ledger_entries cascade`, /immutable_record/);
  await assert.rejects(app.sql`truncate app.audit_logs`, /immutable_record/);
});

test('unbalanced postings are refused', async () => {
  const [acc] = await app.sql`select app.system_account('USDT', 'custody') as id`;
  const [acc2] = await app.sql`select app.system_account('USDT', 'fee_revenue') as id`;
  await assert.rejects(
    app.sql`select app.post_ledger_transaction('adjustment', 'USDT', 'test-unbalanced-0001', 'admin', null, null,
      ${app.sql.json([{ account_id: acc.id, direction: 'debit', amount: '10' }, { account_id: acc2.id, direction: 'credit', amount: '9' }])})`,
    /ledger_unbalanced/,
  );
  await assert.rejects(
    app.sql`select app.post_ledger_transaction('adjustment', 'USDT', 'test-precision-0001', 'admin', null, null,
      ${app.sql.json([{ account_id: acc.id, direction: 'debit', amount: '0.0000001' }, { account_id: acc2.id, direction: 'credit', amount: '0.0000001' }])})`,
    /amount_precision_exceeded/,
  );
});

test('pausing withdrawals is immediate; resuming needs a different approver', async () => {
  const pause = await admin.client.post('/api/v1/admin/settings/withdrawals.enabled', { value: false, reason: 'Incident drill' });
  assert.equal(pause.status, 200);
  assert.equal(pause.data.applied, true);
  const resume = await admin.client.post('/api/v1/admin/settings/withdrawals.enabled', { value: true, reason: 'Incident resolved' });
  assert.equal(resume.status, 202);
  const approvalId = resume.data.approval.id;
  const self = await admin.client.post(`/api/v1/admin/approvals/${approvalId}/approve`, {});
  assert.equal(self.status, 403);
  const other = await admin2.client.post(`/api/v1/admin/approvals/${approvalId}/approve`, { note: 'Checked' });
  assert.equal(other.status, 200);
  const [s] = await app.sql`select value from app.system_settings where key = 'withdrawals.enabled'`;
  assert.equal(s.value, true);
  const history = await app.sql`select new_value, approval_id from app.system_settings_history where key = 'withdrawals.enabled' order by id`;
  assert.equal(history.at(-1).approval_id, approvalId);
});

test('manual balance adjustments only through an approved request', async () => {
  const req = await admin.client.post('/api/v1/admin/settings/adjustments', { userId: alice.userId, asset: 'USDT', direction: 'credit_user', amount: '7', reason: 'Goodwill correction' });
  assert.equal(req.status, 201);
  await assert.rejects(
    app.sql`select app.post_adjustment(${req.data.id}, ${alice.userId}, 'USDT', 'credit_user', 7, 'x', ${admin.userId})`,
    /approval_required/,
  );
  const ok = await admin2.client.post(`/api/v1/admin/approvals/${req.data.id}/approve`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const bal = (await alice.client.get('/api/v1/dashboard')).data.balances.find((b) => b.asset === 'USDT');
  assert.equal(bal.available, '107');
});

test('cron endpoints require the secret', async () => {
  const res = await fetch(`${app.baseUrl}/api/v1/jobs/cleanup`);
  assert.equal(res.status, 403);
});

test('errors never leak internals', async () => {
  const res = await alice.client.get('/api/v1/deposits/not-a-uuid');
  assert.equal(res.status, 422);
  assert.equal(JSON.stringify(res.body).includes('select'), false);
  assert.ok(res.error.requestId);
});
