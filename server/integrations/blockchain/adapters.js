// Webhook payload adapters. Each returns normalised chain events:
// { providerEventId, network, txHash, logIndex, toAddress, memo, fromAddress,
//   asset | tokenContract, amount (decimal string), confirmations, blockNumber,
//   blockHash, reorged, networkFee }
// Direction (incoming/outgoing) is decided by the deposits service, which
// knows which addresses and transaction hashes belong to the platform.

import { z } from 'zod';
import { D, toAmountString } from '../../core/money.js';

const amount = z.string().regex(/^\d{1,30}(\.\d{1,18})?$/);

const genericEvent = z.object({
  id: z.string().min(1).max(200),
  network: z.string().regex(/^[A-Z0-9_]{2,20}$/),
  txHash: z.string().min(16).max(128),
  logIndex: z.number().int().min(0).default(0),
  toAddress: z.string().min(20).max(128),
  memo: z.string().max(64).optional().nullable(),
  fromAddress: z.string().max(128).optional().nullable(),
  asset: z.string().regex(/^[A-Z0-9]{2,10}$/).optional().nullable(),
  tokenContract: z.string().max(128).optional().nullable(),
  amount,
  confirmations: z.number().int().min(0).max(100000),
  blockNumber: z.number().int().min(0).optional().nullable(),
  blockHash: z.string().max(128).optional().nullable(),
  reorged: z.boolean().optional().default(false),
  networkFee: amount.optional().nullable(),
});

const genericPayload = z.object({ events: z.array(genericEvent).min(1).max(500) });

export function parseGenericPayload(body) {
  const parsed = genericPayload.safeParse(body);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  return {
    events: parsed.data.events.map((e) => ({
      providerEventId: e.id,
      network: e.network,
      txHash: e.txHash,
      logIndex: e.logIndex,
      toAddress: e.toAddress,
      memo: e.memo || null,
      fromAddress: e.fromAddress || null,
      asset: e.asset || null,
      tokenContract: e.tokenContract || null,
      amount: e.amount,
      confirmations: e.confirmations,
      blockNumber: e.blockNumber ?? null,
      blockHash: e.blockHash || null,
      reorged: e.reorged,
      networkFee: e.networkFee || null,
      raw: e,
    })),
  };
}

// Alchemy "Address Activity" webhook (EVM). Amounts are taken from the raw
// integer value and decimals, never from the floating-point `value` field.
export function parseAlchemyPayload(body, networkMap) {
  const event = body?.event;
  if (!event || !Array.isArray(event.activity)) return { error: ['event.activity missing'] };
  const network = networkMap[event.network];
  if (!network) return { error: [`unmapped network ${event.network}`] };
  const out = [];
  for (const a of event.activity) {
    if (!a?.hash || !a?.toAddress) continue;
    const rawValue = a.rawContract?.rawValue;
    const decimals = a.rawContract?.decimals !== undefined ? Number(a.rawContract.decimals) : 18;
    if (!rawValue || !Number.isInteger(decimals)) continue;
    const value = new D(BigInt(rawValue).toString()).div(new D(10).pow(decimals));
    if (value.lte(0)) continue;
    const logIndex = a.log?.logIndex !== undefined ? Number.parseInt(a.log.logIndex, 16) || 0 : 0;
    const isNative = a.category === 'external' || a.category === 'internal';
    out.push({
      providerEventId: `${body.id || event.id || 'alchemy'}:${a.hash}:${logIndex}`,
      network,
      txHash: a.hash,
      logIndex,
      toAddress: a.toAddress,
      memo: null,
      fromAddress: a.fromAddress || null,
      asset: isNative ? 'ETH' : null,
      tokenContract: isNative ? null : a.rawContract?.address || null,
      amount: toAmountString(value),
      confirmations: 1,
      blockNumber: a.blockNum ? Number.parseInt(a.blockNum, 16) : null,
      blockHash: a.log?.blockHash || null,
      reorged: Boolean(a.log?.removed),
      networkFee: null,
      raw: a,
    });
  }
  return { events: out };
}
