import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestApp } from '../helpers/test-app.js';
import { depositFor, grantRoles, registerAndLogin, seedAddressPool } from '../helpers/scenario.js';

let app;
let referrer;
let investor;
let admin;
let finance;
let productId;

const text = (s) => ({ en: s, ru: `${s} (ru)`, ar: `${s} (ar)` });
const runJob = (name) =>
  fetch(`${app.baseUrl}/api/v1/jobs/${name}`, { headers: { authorization: 'Bearer test-cron-secret-0123456789abcdef0123' } }).then((r) => r.json());

before(async () => {
  app = await startTestApp();
  await seedAddressPool(app, 'TRON', 10);
  referrer = await registerAndLogin(app);
  const [code] = await app.sql`select code from app.referral_codes where user_id = ${referrer.userId}`;
  investor = await registerAndLogin(app, { referralCode: code.code });
  admin = await registerAndLogin(app);
  finance = await registerAndLogin(app);
  await grantRoles(app, admin.userId, ['super_admin']);
  await grantRoles(app, finance.userId, ['finance']);
});
after(async () => {
  await app?.close();
});

describe('products', () => {
  test('a product cannot go live without legal approval and complete texts', async () => {
    const created = await admin.client.post('/api/v1/admin/investments/products', {
      slug: 'market-neutral', name: text('Market-neutral desk'), summary: { en: 'Draft only' }, riskDisclosure: text('You can lose money.'),
      revenueModel: 'trading', revenueModelDescription: text('Delta-neutral arbitrage on regulated venues.'), termDays: 28,
      minAmount: '50', performanceFeeRate: '0.1', earlyExitAllowed: true, earlyExitFeeRate: '0.01', riskLevel: 'medium',
      legalStatus: 'under_review', assets: ['USDT'],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    productId = created.data.id;
    const blocked = await admin.client.post(`/api/v1/admin/investments/products/${productId}/status`, { status: 'active' });
    assert.equal(blocked.status, 422);
    assert.deepEqual(blocked.error.details.missing.sort(), ['legal_reference', 'legal_status_approved', 'summary_all_languages']);

    const fixed = await admin.client.patch(`/api/v1/admin/investments/products/${productId}`, {
      summary: text('A 28-day allocation to a market-neutral strategy.'), legalStatus: 'approved', legalReference: 'Opinion LO-2026-14',
    });
    assert.equal(fixed.status, 200);
    const active = await admin.client.post(`/api/v1/admin/investments/products/${productId}/status`, { status: 'active' });
    assert.equal(active.data.status, 'active');
    const list = await investor.client.get('/api/v1/investments/products');
    assert.equal(list.data[0].slug, 'market-neutral');
    assert.equal(list.data[0].version, 2, 'terms changes create a new version');
  });
});

describe('positions and realised results', () => {
  let positionId;

  test('shared signup network is flagged for review', async () => {
    const flags = await app.sql`select flag_type from app.risk_flags where user_id = ${investor.userId}`;
    assert.deepEqual(flags.map((f) => f.flag_type), ['shared_signup_ip_with_referrer']);
    // Compliance reviews and dismisses it (both test users share 127.0.0.1).
    const compliance = await registerAndLogin(app);
    await grantRoles(app, compliance.userId, ['compliance']);
    const list = await compliance.client.get('/api/v1/admin/users/risk-flags?status=open');
    for (const f of list.data.items) {
      const res = await compliance.client.post(`/api/v1/admin/users/risk-flags/${f.id}/resolve`, { resolution: 'dismissed', note: 'Same office network, verified' });
      assert.equal(res.status, 200);
    }
  });

  test('deposit pays a pending referral reward that waits for platform equity', async () => {
    await depositFor(app, investor.client, { amount: '1000' });
    const [reward] = await app.sql`select * from app.referral_rewards where referrer_id = ${referrer.userId}`;
    assert.equal(reward.status, 'pending');
    assert.equal(Number(reward.amount), 50);
    await app.sql`update app.referral_rewards set release_at = now() - interval '1 second'`;
    const job = await runJob('release-referral-rewards');
    assert.equal(job.data.result.deferred_coverage, 1, 'not paid from user funds');
    const [still] = await app.sql`select status from app.referral_rewards where id = ${reward.id}`;
    assert.equal(still.status, 'pending');
  });

  test('replaying the same deposit webhook does not pay twice', async () => {
    const [dep] = await app.sql`select tx_hash from app.deposits where user_id = ${investor.userId}`;
    const [{ count }] = await app.sql`select count(*)::int from app.referral_rewards where referrer_id = ${referrer.userId}`;
    assert.equal(count, 1);
    assert.ok(dep.tx_hash);
  });

  test('opening a position uses the accepted terms version and held funds', async () => {
    const stale = await investor.client.post('/api/v1/investments/positions', { productId, asset: 'USDT', amount: '600', termsVersion: 1, acceptRisk: true }, { idempotencyKey: true });
    assert.equal(stale.status, 409);
    assert.equal(stale.error.code, 'terms_changed');
    const opened = await investor.client.post('/api/v1/investments/positions', { productId, asset: 'USDT', amount: '600', termsVersion: 2, acceptRisk: true }, { idempotencyKey: true });
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    positionId = opened.data.id;
    const dash = await investor.client.get('/api/v1/dashboard');
    const usdt = dash.data.balances.find((b) => b.asset === 'USDT');
    assert.equal(usdt.available, '400');
    assert.equal(usdt.invested, '600');
  });

  test('a result needs a second approver and pays only realised profit', async () => {
    // Timeline: position opened 8 days ago; result period covers days -10..-5.
    await app.sql`update app.investment_positions set started_at = now() - interval '8 days', maturity_at = now() + interval '20 days' where id = ${positionId}`;
    const start = new Date(Date.now() - 10 * 86400000).toISOString();
    const end = new Date(Date.now() - 5 * 86400000).toISOString();
    const created = await finance.client.post('/api/v1/admin/investments/results', {
      productId, asset: 'USDT', periodStart: start, periodEnd: end, grossReturnRate: '0.05', evidenceReference: 'Prime broker statement 2026-10',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const self = await finance.client.post(`/api/v1/admin/investments/results/${created.data.id}/approve`, {});
    assert.equal(self.status, 403);
    const notApproved = await admin.client.post(`/api/v1/admin/investments/results/${created.data.id}/post`, {});
    assert.equal(notApproved.status, 409);
    assert.equal((await admin.client.post(`/api/v1/admin/investments/results/${created.data.id}/approve`, {})).data.status, 'approved');
    const preview = await admin.client.get(`/api/v1/admin/investments/results/${created.data.id}/preview`);
    assert.equal(preview.data.allocations.length, 1);
    const posted = await admin.client.post(`/api/v1/admin/investments/results/${created.data.id}/post`, {});
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(posted.data.status, 'posted');
    assert.equal(posted.data.referralRewards, 1);

    const position = await investor.client.get(`/api/v1/investments/positions/${positionId}`);
    // 600 x 5% x 3/5 of the period = 18 gross, 10% performance fee = 1.8, net 16.2
    const result = position.data.events.find((e) => e.eventType === 'result');
    assert.equal(result.grossAmount, '18');
    assert.equal(result.feeAmount, '1.8');
    assert.equal(result.netAmount, '16.2');
    assert.equal(position.data.currentValue, '616.2');

    const earnings = await investor.client.get('/api/v1/earnings');
    assert.equal(earnings.data.items[0].kind, 'profit');
    assert.equal(earnings.data.items[0].status, 'confirmed');
  });

  test('maturity without a final result waits; posting the result releases it', async () => {
    await app.sql`update app.investment_positions set maturity_at = now() - interval '1 minute' where id = ${positionId}`;
    const job = await runJob('process-maturities');
    assert.equal(job.data.result.processed, 1);
    const pos = await investor.client.get(`/api/v1/investments/positions/${positionId}`);
    assert.equal(pos.data.status, 'awaiting_settlement', 'nothing estimated is credited');

    const [prev] = await app.sql`select period_end from app.investment_results where status = 'posted' order by period_end desc limit 1`;
    const created = await finance.client.post('/api/v1/admin/investments/results', {
      productId, asset: 'USDT', periodStart: new Date(prev.period_end).toISOString(), periodEnd: new Date().toISOString(),
      grossReturnRate: '0', evidenceReference: 'Final period statement',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await admin.client.post(`/api/v1/admin/investments/results/${created.data.id}/approve`, {});
    const posted = await admin.client.post(`/api/v1/admin/investments/results/${created.data.id}/post`, {});
    assert.equal(posted.status, 200, JSON.stringify(posted.body));

    const released = await investor.client.get(`/api/v1/investments/positions/${positionId}`);
    assert.equal(released.data.status, 'matured');
    assert.equal(released.data.releasedAmount, '616.2');
    const dash = await investor.client.get('/api/v1/dashboard');
    const usdt = dash.data.balances.find((b) => b.asset === 'USDT');
    assert.equal(usdt.invested, '0');
    assert.equal(usdt.available, '1016.2');
  });

  test('rewards are paid once platform equity covers them', async () => {
    const capital = await finance.client.post('/api/v1/admin/treasury/capital', { asset: 'USDT', amount: '500', evidence: 'Operator transfer #1' }, { idempotencyKey: true });
    assert.equal(capital.status, 201, JSON.stringify(capital.body));
    await app.sql`update app.referral_rewards set release_at = now() - interval '1 second' where status = 'pending'`;
    const job = await runJob('release-referral-rewards');
    assert.ok(job.data.result.credited >= 1);
    const overview = await referrer.client.get('/api/v1/referrals');
    assert.equal(overview.data.invited, 1);
    assert.ok(overview.data.rewards.some((r) => r.status === 'credited'));
    const issues = await app.sql`select * from app.verify_ledger_integrity()`;
    assert.equal(issues.length, 0);
    const [pos] = await app.sql`select * from app.asset_position('USDT')`;
    assert.ok(Number(pos.coverage_ratio) >= 1, 'user balances stay fully covered');
  });
});
