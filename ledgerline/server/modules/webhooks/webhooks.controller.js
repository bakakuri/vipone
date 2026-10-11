// Inbound webhooks: blockchain notifications and KYC results. They are
// authenticated by HMAC signatures over the raw body (no cookies, no CSRF).

import { getConfig } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { sendData } from '../../core/respond.js';
import { withTransaction } from '../../db/client.js';
import { parseAlchemyPayload, parseGenericPayload } from '../../integrations/blockchain/adapters.js';
import { verifyAlchemySignature, verifyGenericSignature } from '../../integrations/blockchain/signatures.js';
import { getKycProvider } from '../../integrations/kyc/index.js';
import { ingestChainEvents } from '../deposits/deposits.service.js';

export async function genericBlockchain(req, res) {
  const { blockchain } = getConfig();
  if (!verifyGenericSignature(blockchain.webhookSecret, req.rawBody || '', req.get('x-ledgerline-signature'))) {
    throw new AppError('unauthenticated', { details: { reason: 'invalid_signature' } });
  }
  const parsed = parseGenericPayload(req.body);
  if (parsed.error) throw new AppError('validation_failed', { details: parsed.error.map((m) => ({ path: 'body', code: m })) });
  const provider = String(req.get('x-ledgerline-provider') || 'generic').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'generic';
  const results = await ingestChainEvents(provider, parsed.events);
  sendData(res, { processed: results.length, results });
}

export async function alchemy(req, res) {
  const { blockchain } = getConfig();
  if (!verifyAlchemySignature(blockchain.alchemySigningKeys, req.rawBody || '', req.get('x-alchemy-signature'))) {
    throw new AppError('unauthenticated', { details: { reason: 'invalid_signature' } });
  }
  const parsed = parseAlchemyPayload(req.body, blockchain.alchemyNetworkMap);
  if (parsed.error) {
    logger.warn('alchemy_payload_rejected', { errors: parsed.error });
    return sendData(res, { processed: 0 });
  }
  const results = await ingestChainEvents('alchemy', parsed.events);
  sendData(res, { processed: results.length });
}

export async function sumsub(req, res) {
  const provider = getKycProvider();
  const headers = { 'x-payload-digest': req.get('x-payload-digest'), 'x-payload-digest-alg': req.get('x-payload-digest-alg') };
  if (!provider.verifyWebhook(req.rawBody || '', headers)) throw new AppError('unauthenticated', { details: { reason: 'invalid_signature' } });
  const update = provider.parseWebhook(req.body);
  if (!update) return sendData(res, { ignored: true });
  await withTransaction(async (tx) => {
    const [profile] = await tx`select id from app.profiles where id = ${update.userId}`;
    if (!profile) return;
    const status = update.status === 'rejected' && !update.final ? 'pending' : update.status;
    await tx`
      insert into app.kyc_verifications (user_id, provider, provider_reference, status, reason)
      values (${update.userId}, ${provider.name}, ${update.providerReference}, ${status}, ${update.reason})
      on conflict (provider, provider_reference) do update set status = excluded.status, reason = excluded.reason, updated_at = now()`;
    await tx`update app.profiles set kyc_status = ${status} where id = ${update.userId}`;
    await tx`select app.notify(${update.userId}, 'kyc_updated', ${tx.json({ status })}, '/profile')`;
  });
  sendData(res, { processed: true });
}
