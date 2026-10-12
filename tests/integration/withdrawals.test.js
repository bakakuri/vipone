import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { startTestApp } from '../helpers/test-app.js';
import {
  addConfirmedWallet, depositFor, enableMfa, grantRoles, registerAndLogin, releaseHolds, seedAddressPool, txHash,
} from '../helpers/scenario.js';

let app;
let user;
let wallet;
let finance1;
let finance2;

before(async () => {
  app = await startTestApp();
  await seedAddressPool(app, 'TRON', 10);
  user = await registerAndLogin(app);
  finance1 = await registerAndLogin(app);
  finance2 = await registerAndLogin(app);
  await grantRoles(app, finance1.userId, ['finance']);
  await grantRoles(app, finance2.userId, ['finance']);
  await depositFor(app, user.client, { amount: '1000' });
});
after(async () => {
  await app?.close();
});

const balances = async () => (await user.client.get('/api/v1/dashboard')).data.balances.find((b) => b.asset === 'USDT');

describe('withdrawal addresses', () => {
  test('adding an address requires two-factor authentication', async () => {
    const res = await user.client.post('/api/v1/wallets', { label: 'x', asset: 'USDT', network: 'TRON', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' });
    assert.equal(res.status, 403);
    assert.equal(res.error.code, 'mfa_setup_required');
  });

  test('checksum errors are rejected, valid address needs an emailed code', async () => {
    await enableMfa(user.client);
    await app.sql`update app.system_settings set value = 'true' where key = 'withdrawal.address_email_confirmation'`;
    const bad = await user.client.post('/api/v1/wallets', { label: 'Typo', asset: 'USDT', network: 'TRON', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u' });
    assert.equal(bad.status, 422);
    assert.equal(bad.error.details[0].code, 'address_checksum');

    const added = await user.client.post('/api/v1/wallets', { label: 'Ledger', asset: 'USDT', network: 'TRON', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' });
    assert.equal(added.status, 201);
    assert.equal(added.data.status, 'pending_confirmation');
    const wrong = await user.client.post(`/api/v1/wallets/${added.data.id}/confirm`, { code: added.data.devCode === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 422);
    const ok = await user.client.post(`/api/v1/wallets/${added.data.id}/confirm`, { code: added.data.devCode });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.status, 'active');
    assert.ok(new Date(ok.data.usableFrom) > new Date(), 'new address is in cooldown');
    const emails = app.emails().filter((m) => m.to === user.email && m.subject.includes('withdrawal address'));
    assert.ok(emails.length >= 1, 'confirmation code was emailed');
  });

  test('with email codes switched off, a new address is active at once but still cools down', async () => {
    await app.sql`update app.system_settings set value = 'false' where key = 'withdrawal.address_email_confirmation'`;
    const before = app.emails().length;
    const added = await user.client.post('/api/v1/wallets', { label: 'Exchange', asset: 'USDT', network: 'TRON', address: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf' });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.equal(added.data.status, 'active');
    assert.equal(added.data.devCode, undefined);
    assert.ok(new Date(added.data.usableFrom) > new Date(), 'new address is in cooldown');
    assert.equal(app.emails().length, before, 'no email was sent');
    await user.client.del(`/api/v1/wallets/${added.data.id}`);
  });
});

describe('withdrawal requests', () => {
  test('new address cooldown and the 7-day deposit hold block withdrawals', async () => {
    const [w] = (await user.client.get('/api/v1/wallets')).data;
    const quote = await user.client.post('/api/v1/withdrawals/quote', { walletId: w.id, amount: '100' });
    assert.equal(quote.status, 200);
    const cooling = await user.client.post('/api/v1/withdrawals', { quoteId: quote.data.id }, { idempotencyKey: true });
    assert.equal(cooling.status, 409);
    assert.equal(cooling.error.code, 'wallet_cooldown');

    await app.sql`update app.withdrawal_wallets set usable_from = now() - interval '1 second' where id = ${w.id}`;
    wallet = w;
    const q2 = await user.client.post('/api/v1/withdrawals/quote', { walletId: w.id, amount: '100' });
    const held = await user.client.post('/api/v1/withdrawals', { quoteId: q2.data.id }, { idempotencyKey: true });
    assert.equal(held.status, 409);
    assert.equal(held.error.code, 'insufficient_withdrawable_balance');
    await releaseHolds(app, user.userId);
  });

  test('server-side fee quote: 3% platform fee plus the network fee', async () => {
    const quote = await user.client.post('/api/v1/withdrawals/quote', { walletId: wallet.id, amount: '100' });
    assert.equal(quote.data.amount, '100');
    assert.equal(quote.data.platformFee, '3');
    assert.equal(quote.data.networkFee, '1.5');
    assert.equal(quote.data.netAmount, '95.5');
    const below = await user.client.post('/api/v1/withdrawals/quote', { walletId: wallet.id, amount: '10' });
    assert.equal(below.status, 422);
    assert.equal(below.error.code, 'amount_below_minimum');
  });

  test('double submit with the same idempotency key creates one request', async () => {
    const quote = await user.client.post('/api/v1/withdrawals/quote', { walletId: wallet.id, amount: '100' });
    const key = crypto.randomUUID();
    const [a, b] = [
      await user.client.post('/api/v1/withdrawals', { quoteId: quote.data.id }, { idempotencyKey: key }),
      await user.client.post('/api/v1/withdrawals', { quoteId: quote.data.id }, { idempotencyKey: key }),
    ];
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.headers.get('idempotent-replay'), 'true');
    assert.equal(a.data.id, b.data.id);
    const bal = await balances();
    assert.equal(bal.available, '900');
    assert.equal(bal.withdrawalHold, '100');
    const reuse = await user.client.post('/api/v1/withdrawals', { quoteId: crypto.randomUUID() }, { idempotencyKey: key });
    assert.equal(reuse.status, 422);
    assert.equal(reuse.error.code, 'idempotency_key_reuse');
  });

  test('concurrent requests can never spend the same funds twice', async () => {
    const amount = '500';
    const quotes = await Promise.all([1, 2].map(() => user.client.post('/api/v1/withdrawals/quote', { walletId: wallet.id, amount })));
    const results = await Promise.all(quotes.map((q) => user.client.post('/api/v1/withdrawals', { quoteId: q.data.id }, { idempotencyKey: true })));
    const created = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status === 409);
    assert.equal(created.length, 1, 'exactly one succeeds');
    assert.equal(refused.length, 1);
    assert.equal(refused[0].error.code, 'insufficient_withdrawable_balance');
    const bal = await balances();
    assert.equal(bal.available, '400');
    assert.equal(bal.withdrawalHold, '600');
  });

  test('cancelling a pending request returns the funds', async () => {
    const list = await user.client.get('/api/v1/withdrawals?status=pending');
    const target = list.data.items.find((w) => w.amount === '500');
    const cancel = await user.client.post(`/api/v1/withdrawals/${target.id}/cancel`, {});
    assert.equal(cancel.status, 200);
    assert.equal(cancel.data.status, 'cancelled');
    const again = await user.client.post(`/api/v1/withdrawals/${target.id}/cancel`, {});
    assert.equal(again.status, 409);
    const bal = await balances();
    assert.equal(bal.available, '900');
  });
});

describe('admin processing', () => {
  let requestId;
  before(async () => {
    const list = await user.client.get('/api/v1/withdrawals?status=pending');
    requestId = list.data.items[0].id;
  });

  test('regular users cannot reach admin endpoints', async () => {
    const res = await user.client.post(`/api/v1/admin/withdrawals/${requestId}/approve`, {});
    assert.equal(res.status, 403);
  });

  test('completion needs a tx hash and an independent verifier', async () => {
    assert.equal((await finance1.client.post(`/api/v1/admin/withdrawals/${requestId}/approve`, {})).data.status, 'approved');
    const early = await finance1.client.post(`/api/v1/admin/withdrawals/${requestId}/complete`, {});
    assert.equal(early.status, 409);
    assert.equal((await finance1.client.post(`/api/v1/admin/withdrawals/${requestId}/process`, {})).data.status, 'processing');
    const noHash = await finance2.client.post(`/api/v1/admin/withdrawals/${requestId}/complete`, {});
    assert.equal(noHash.status, 422);
    assert.equal(noHash.error.code, 'tx_hash_required');
    const hash = txHash();
    assert.equal((await finance1.client.post(`/api/v1/admin/withdrawals/${requestId}/broadcast`, { txHash: hash })).status, 200);
    const self = await finance1.client.post(`/api/v1/admin/withdrawals/${requestId}/complete`, {});
    assert.equal(self.status, 403);
    assert.equal(self.error.code, 'independent_verifier_required');
    const done = await finance2.client.post(`/api/v1/admin/withdrawals/${requestId}/complete`, { actualNetworkFee: '1.2' });
    assert.equal(done.status, 200);
    assert.equal(done.data.status, 'completed');

    const bal = await balances();
    assert.equal(bal.withdrawalHold, '0');
    assert.equal(bal.total, '900');
    const [fees] = await app.sql`
      select (select balance from app.ledger_balances b join app.ledger_accounts a on a.id = b.account_id where a.owner_type = 'system' and a.asset_code = 'USDT' and a.account_type = 'fee_revenue') as fee,
             (select balance from app.ledger_balances b join app.ledger_accounts a on a.id = b.account_id where a.owner_type = 'system' and a.asset_code = 'USDT' and a.account_type = 'custody') as custody`;
    assert.equal(Number(fees.fee), 3);
    assert.equal(Number(fees.custody), 1000 - 95.5 - 1.2);
    const audit = await app.sql`select action from app.audit_logs where entity_id = ${requestId} order by id`;
    assert.deepEqual(audit.map((a) => a.action), ['withdrawal.approve', 'withdrawal.process', 'withdrawal.broadcast', 'withdrawal.complete']);
  });

  test('rejection returns funds; failing requires confirming nothing was sent', async () => {
    const quote = await user.client.post('/api/v1/withdrawals/quote', { walletId: wallet.id, amount: '200' });
    const created = await user.client.post('/api/v1/withdrawals', { quoteId: quote.data.id }, { idempotencyKey: true });
    const rej = await finance1.client.post(`/api/v1/admin/withdrawals/${created.data.id}/reject`, { reason: 'Destination needs review' });
    assert.equal(rej.data.status, 'rejected');
    assert.equal((await balances()).available, '900');

    const q2 = await user.client.post('/api/v1/withdrawals/quote', { walletId: wallet.id, amount: '200' });
    const c2 = await user.client.post('/api/v1/withdrawals', { quoteId: q2.data.id }, { idempotencyKey: true });
    await finance1.client.post(`/api/v1/admin/withdrawals/${c2.data.id}/approve`, {});
    await finance1.client.post(`/api/v1/admin/withdrawals/${c2.data.id}/process`, {});
    const noConfirm = await finance1.client.post(`/api/v1/admin/withdrawals/${c2.data.id}/fail`, { reason: 'Node rejected transaction' });
    assert.equal(noConfirm.status, 422);
    const failed = await finance1.client.post(`/api/v1/admin/withdrawals/${c2.data.id}/fail`, { reason: 'Node rejected transaction', fundsNotSent: true });
    assert.equal(failed.data.status, 'failed');
    assert.equal((await balances()).available, '900');
  });

  test('large withdrawals need two different approvers', async () => {
    await app.sql`update app.system_settings set value = '{"USDT": "300"}' where key = 'withdrawal.dual_approval_threshold'`;
    const quote = await user.client.post('/api/v1/withdrawals/quote', { walletId: wallet.id, amount: '400' });
    const created = await user.client.post('/api/v1/withdrawals', { quoteId: quote.data.id }, { idempotencyKey: true });
    const first = await finance1.client.post(`/api/v1/admin/withdrawals/${created.data.id}/approve`, {});
    assert.equal(first.data.status, 'under_review');
    const same = await finance1.client.post(`/api/v1/admin/withdrawals/${created.data.id}/approve`, {});
    assert.equal(same.status, 403);
    const second = await finance2.client.post(`/api/v1/admin/withdrawals/${created.data.id}/approve`, {});
    assert.equal(second.data.status, 'approved');
  });

  test('the ledger stays balanced', async () => {
    const issues = await app.sql`select * from app.verify_ledger_integrity()`;
    assert.equal(issues.length, 0);
  });
});
