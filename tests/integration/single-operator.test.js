// The production set-up for one operator: no second approver, no two-factor
// or identity requirement. One super administrator can change settings and
// balances, approve and pay any withdrawal, manage accounts, announcements
// and payment reports on their own — and every action is still audited.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApp } from '../helpers/test-app.js';
import { PASSWORD, enableMfa, evmAddress, grantRoles, registerAndLogin, txHash } from '../helpers/scenario.js';

let app;
let admin;
let user;

before(async () => {
  app = await startTestApp();
  // Same configuration as the single-operator and manual-operations migrations.
  await app.sql`update app.system_settings set value = 'false'::jsonb where key in ('security.require_second_approver', 'withdrawal.require_mfa', 'deposits.automatic')`;
  await app.sql`update app.system_settings set value = '0'::jsonb where key = 'withdrawal.new_address_cooldown_hours'`;
  await app.sql`update app.asset_networks set deposit_enabled = (asset_code = 'USDT' and network_code = 'BSC'), withdrawal_enabled = (asset_code = 'USDT' and network_code = 'BSC')`;
  admin = await registerAndLogin(app);
  await grantRoles(app, admin.userId, ['super_admin']);
  user = await registerAndLogin(app);
});
after(async () => {
  await app?.close();
});

const balance = async () => (await user.client.get('/api/v1/dashboard')).data.balances.find((b) => b.asset === 'USDT');
const audited = async (action) => (await app.sql`select count(*)::int as n from app.audit_logs where action = ${action}`)[0].n;

test('settings change at once, without two-factor or a second person', async () => {
  const res = await admin.client.post('/api/v1/admin/settings/funds.deposit_hold_days', { value: 0, reason: 'No hold for manual deposits' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.data.applied, true);
  const [row] = await app.sql`select value from app.system_settings where key = 'funds.deposit_hold_days'`;
  assert.equal(row.value, 0);
  const config = (await user.client.get('/api/v1/public/config')).data;
  assert.equal(config.secondApprover, false);
  assert.equal(config.withdrawalMfa, false);
});

test('the admin changes a balance directly; it is booked in the ledger and audited', async () => {
  const res = await admin.client.post('/api/v1/admin/settings/adjustments', { userId: user.userId, asset: 'USDT', direction: 'credit_user', amount: '12000', reason: 'Deposit checked on BscScan' });
  assert.ok(res.status < 300, JSON.stringify(res.body));
  assert.equal(res.data.status, 'executed');
  assert.equal((await balance()).available, '12000');
  const down = await admin.client.post('/api/v1/admin/settings/adjustments', { userId: user.userId, asset: 'USDT', direction: 'debit_user', amount: '500', reason: 'Correction' });
  assert.equal(down.data.status, 'executed');
  assert.equal((await balance()).available, '11500');
  assert.ok((await audited('approval.executed')) >= 2);
  assert.equal((await app.sql`select * from app.verify_ledger_integrity()`).length, 0);
});

test('a payment the admin received is added as a deposit; a large withdrawal is approved and paid by one admin', async () => {
  await admin.client.post('/api/v1/admin/deposits/methods', { asset: 'USDT', network: 'BSC', address: evmAddress() });
  const added = await admin.client.post('/api/v1/admin/deposits/add', { userId: user.userId, amount: '20000', txHash: txHash(), reason: 'Paid by bank-to-crypto desk, checked on BscScan' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.data.status, 'credited');
  assert.equal((await balance()).total, '31500');

  const quote = await user.client.post('/api/v1/withdrawals/quote', { asset: 'USDT', network: 'BSC', address: evmAddress(), amount: '11000' });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  const request = await user.client.post('/api/v1/withdrawals', { quoteId: quote.data.id }, { idempotencyKey: true });
  assert.equal(request.status, 201, JSON.stringify(request.body));
  const id = request.data.id;
  assert.equal((await admin.client.get(`/api/v1/admin/withdrawals/${id}`)).data.requiresDualApproval, true);
  const paid = await admin.client.post(`/api/v1/admin/withdrawals/${id}/pay`, { txHash: txHash() });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.data.status, 'completed');
  assert.equal((await app.sql`select * from app.verify_ledger_integrity()`).length, 0);
});

test('roles and reinstatements apply at once; accounts can be edited and deleted', async () => {
  const other = await registerAndLogin(app);
  const role = await admin.client.post(`/api/v1/admin/users/${other.userId}/roles`, { role: 'support', action: 'grant', reason: 'Helps with support' });
  assert.equal(role.data.status, 'executed');
  assert.deepEqual((await app.sql`select role from app.user_roles where user_id = ${other.userId}`).map((r) => r.role), ['support']);

  const edited = await admin.client.patch(`/api/v1/admin/users/${other.userId}`, { displayName: 'Nino', countryCode: 'DE', locale: 'ka' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.data.displayName, 'Nino');
  assert.equal(edited.data.locale, 'ka');

  const closed = await admin.client.post(`/api/v1/admin/users/${other.userId}/status`, { status: 'closed', reason: 'Asked to delete the account' });
  assert.equal(closed.data.applied, true);
  const login = await app.client().post('/api/v1/auth/login', { email: other.email, password: PASSWORD });
  assert.equal(login.status, 403);

  const back = await admin.client.post(`/api/v1/admin/users/${other.userId}/status`, { status: 'active', reason: 'Reopened on request' });
  assert.equal(back.data.applied, true);
  assert.equal((await app.client().post('/api/v1/auth/login', { email: other.email, password: PASSWORD })).status, 200);
});

test('the admin turns off two-factor for a user who lost the phone', async () => {
  const other = await registerAndLogin(app);
  await enableMfa(other.client);
  const before = await app.client().post('/api/v1/auth/login', { email: other.email, password: PASSWORD });
  assert.equal(before.data.mfaRequired, true);
  const reset = await admin.client.post(`/api/v1/admin/users/${other.userId}/mfa-reset`, { reason: 'Lost the phone, identity checked by video call' });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  const afterReset = await app.client().post('/api/v1/auth/login', { email: other.email, password: PASSWORD });
  assert.equal(afterReset.status, 200);
  assert.equal(afterReset.data.mfaRequired, false);
});

test('an announcement in Georgian only is published, corrected and deleted', async () => {
  const created = await admin.client.post('/api/v1/admin/announcements', { title: { ka: 'სიახლე' }, body: { ka: 'საიტი განახლდა.' } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.data.title.ka, 'სიახლე');
  assert.equal(created.data.title.en, 'სიახლე', 'other languages show the text that was written');
  const id = created.data.id;
  const edited = await admin.client.patch(`/api/v1/admin/announcements/${id}`, { title: { ka: 'სიახლე!' }, body: { ka: 'საიტი განახლდა დღეს.' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const [n] = await app.sql`select params from app.notifications where user_id = ${user.userId} and type = 'announcement' and params->>'announcementId' = ${id}::text`;
  assert.equal(n.params.title.ka, 'სიახლე!');
  const removed = await admin.client.del(`/api/v1/admin/announcements/${id}`);
  assert.equal(removed.status, 200);
  assert.equal((await app.sql`select count(*)::int as n from app.notifications where params->>'announcementId' = ${id}::text`)[0].n, 0);
  assert.equal(await audited('announcement.deleted'), 1);
});

test('an uncredited payment report can be deleted; a credited one cannot', async () => {
  const [method] = (await user.client.get('/api/v1/deposits/methods')).data.methods;
  const report = (await user.client.post('/api/v1/deposits/manual', { methodId: method.id, amount: '50' }, { idempotencyKey: true })).data;
  const credited = (await user.client.post('/api/v1/deposits/manual', { methodId: method.id, amount: '60' }, { idempotencyKey: true })).data;
  await admin.client.post(`/api/v1/admin/deposits/${credited.id}/approve-manual`, { txHash: txHash(), reason: 'Found on BscScan' });

  const del = await admin.client.del(`/api/v1/admin/deposits/${report.id}`);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await app.sql`select count(*)::int as n from app.deposits where id = ${report.id}`)[0].n, 0);
  const refused = await admin.client.del(`/api/v1/admin/deposits/${credited.id}`);
  assert.equal(refused.status, 409);
  assert.equal(refused.error.code, 'deposit_not_deletable');
});

test('turning the four-eyes rule back on restores the second-person checks', async () => {
  const on = await admin.client.post('/api/v1/admin/settings/security.require_second_approver', { value: true, reason: 'Second admin hired' });
  assert.equal(on.data.applied, true, 'tightening applies at once');
  const req = await admin.client.post('/api/v1/admin/settings/adjustments', { userId: user.userId, asset: 'USDT', direction: 'credit_user', amount: '1', reason: 'Goodwill' });
  assert.equal(req.data.status, 'pending');
  const self = await admin.client.post(`/api/v1/admin/approvals/${req.data.id}/approve`, {});
  assert.equal(self.status, 403);
});
