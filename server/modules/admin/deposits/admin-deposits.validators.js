import { z } from 'zod';
import { amount, assetCode, networkCode, pagination, reason, txHash, uuid } from '../../../utils/schemas.js';
import { DEPOSIT_STATUSES } from '../../deposits/deposits.validators.js';

export const listQuery = z.object({
  status: z.enum(DEPOSIT_STATUSES).optional(),
  asset: assetCode.optional(),
  network: networkCode.optional(),
  source: z.enum(['chain', 'manual']).optional(),
  search: z.string().trim().max(150).optional(),
  ...pagination,
});
export const idParams = z.object({ id: uuid });
export const reviewBody = z.object({ decision: z.enum(['hold', 'approve', 'reject']), reason });
export const returnBody = z.object({ txHash });
export const importBody = z.object({
  network: networkCode,
  addresses: z.array(z.string().trim().min(20).max(128)).max(5000).default([]),
  sharedAddress: z.string().trim().max(128).optional(),
  memoCount: z.number().int().min(1).max(5000).optional(),
});

// Published deposit methods (address, memo, QR image, instructions).
const QR_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const optionalText = (max) => z.string().trim().max(max, 'too_long').nullable().optional();
export const methodBody = z.object({
  asset: assetCode,
  network: networkCode,
  label: optionalText(80),
  address: z.string().trim().min(10, 'too_short').max(200, 'too_long'),
  memo: optionalText(100),
  qrImage: z.string().max(700000, 'too_large').regex(QR_DATA_URL, 'invalid').nullable().optional(),
  instructions: z
    .object({ en: optionalText(4000), ru: optionalText(4000), ar: optionalText(4000), ka: optionalText(4000) })
    .default({})
    .transform((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v))),
  minAmount: amount.nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export const approveManualBody = z.object({ amount: amount.optional(), txHash: txHash.optional(), reason });
export const addDepositBody = z.object({ userId: uuid, asset: assetCode.optional(), amount, txHash, reason });
