// Demo tools (APP_MODE=demo with DEMO_TOOLS_ENABLED=true only).
// They do NOT write balances directly: they generate signed-equivalent chain
// events that go through the exact same ingestion pipeline as production
// webhooks, so the demo exercises the real deposit and withdrawal flows.

import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getConfig } from '../../../config/env.js';
import { AppError } from '../../../core/errors.js';
import { sendData } from '../../../core/respond.js';
import { getSql, withTransaction } from '../../../db/client.js';
import { requirePermission } from '../../../middleware/authenticate.js';
import { validate } from '../../../middleware/validate.js';
import { amount, assetCode, networkCode, uuid } from '../../../utils/schemas.js';
import { audit } from '../../audit/audit.service.js';
import { ingestChainEvents } from '../../deposits/deposits.service.js';

function requireDemo() {
  return (req, res, next) => (getConfig().demoToolsEnabled ? next() : next(new AppError('route_not_found')));
}

const fakeHash = () => `demo${crypto.randomBytes(30).toString('hex')}`;

export function adminDemoRoutes() {
  const r = Router();
  r.use(requireDemo(), requirePermission('demo.tools'));

  r.post(
    '/simulate-deposit',
    validate({ body: z.object({ email: z.string().email(), asset: assetCode, network: networkCode, amount, confirmations: z.number().int().min(0).max(1000).default(1) }) }),
    async (req, res) => {
      const { email, asset, network, confirmations } = req.body;
      const sql = getSql();
      const [user] = await sql`select id from app.profiles where lower(email) = lower(${email})`;
      if (!user) throw new AppError('not_found');
      const address = await withTransaction(async (tx) => (await tx`select * from app.assign_deposit_address(${user.id}, ${network})`)[0]);
      const txHash = fakeHash();
      const results = await ingestChainEvents('demo', [{
        providerEventId: `demo:${txHash}:0:${confirmations}`,
        network, txHash, logIndex: 0, toAddress: address.address, memo: address.memo, fromAddress: null,
        asset, amount: req.body.amount, confirmations, blockNumber: null, reorged: false, raw: { demo: true },
      }]);
      await audit(sql, req, { action: 'demo.simulated_deposit', entityType: 'deposit', entityId: results[0]?.depositId, after: req.body });
      sendData(res, { txHash, ...results[0] });
    },
  );

  r.post(
    '/advance-confirmations',
    validate({ body: z.object({ depositId: uuid, confirmations: z.number().int().min(1).max(1000) }) }),
    async (req, res) => {
      const sql = getSql();
      const [d] = await sql`
        select d.*, a.address, a.memo from app.deposits d join app.deposit_addresses a on a.id = d.deposit_address_id where d.id = ${req.body.depositId}`;
      if (!d || !d.tx_hash) throw new AppError('not_found');
      const results = await ingestChainEvents('demo', [{
        providerEventId: `demo:${d.tx_hash}:${d.log_index}:${req.body.confirmations}`,
        network: d.network_code, txHash: d.tx_hash, logIndex: d.log_index, toAddress: d.address, memo: d.memo,
        asset: d.asset_code, amount: d.amount, confirmations: req.body.confirmations, reorged: false, raw: { demo: true },
      }]);
      sendData(res, results[0]);
    },
  );

  r.post('/confirm-withdrawal', validate({ body: z.object({ withdrawalId: uuid }) }), async (req, res) => {
    const sql = getSql();
    const [w] = await sql`
      select w.*, n.required_confirmations from app.withdrawal_requests w join app.networks n on n.code = w.network_code
      where w.id = ${req.body.withdrawalId}`;
    if (!w || w.status !== 'processing' || !w.tx_hash) throw new AppError('invalid_status_transition', { status: 409 });
    const results = await ingestChainEvents('demo', [{
      providerEventId: `demo:out:${w.tx_hash}`,
      network: w.network_code, txHash: w.tx_hash, logIndex: 0, toAddress: w.address, memo: w.memo,
      asset: w.asset_code, amount: w.net_amount, confirmations: w.required_confirmations, reorged: false,
      networkFee: w.network_fee, raw: { demo: true },
    }]);
    await audit(sql, req, { action: 'demo.confirmed_withdrawal', entityType: 'withdrawal_request', entityId: w.id });
    sendData(res, results[0]);
  });
  return r;
}
