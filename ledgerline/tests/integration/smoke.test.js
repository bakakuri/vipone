import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApp } from '../helpers/test-app.js';
import { depositFor, registerAndLogin, seedAddressPool } from '../helpers/scenario.js';

let app;
before(async () => {
  app = await startTestApp();
});
after(async () => {
  await app?.close();
});

test('health, public config and a full deposit through the webhook pipeline', async () => {
  const client = app.client();
  const health = await client.get('/api/v1/health');
  assert.equal(health.status, 200);
  const cfg = await client.get('/api/v1/public/config');
  assert.equal(cfg.data.mode, 'demo');

  const user = await registerAndLogin(app);
  const session = await user.client.get('/api/v1/auth/session');
  assert.equal(session.data.authenticated, true);

  await seedAddressPool(app, 'TRON', 3);
  const dep = await depositFor(app, user.client, { amount: '250.5' });
  assert.equal(dep.result.status, 'credited');

  const dash = await user.client.get('/api/v1/dashboard');
  assert.equal(dash.status, 200);
  const usdt = dash.data.balances.find((b) => b.asset === 'USDT');
  assert.equal(usdt.available, '250.5');
  assert.equal(usdt.withdrawable, '0');
  assert.equal(usdt.depositHold, '250.5');
});
