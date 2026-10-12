import { z } from 'zod';
import { assetCode, networkCode, pagination, reason, txHash, uuid } from '../../../utils/schemas.js';
import { DEPOSIT_STATUSES } from '../../deposits/deposits.validators.js';

export const listQuery = z.object({
  status: z.enum(DEPOSIT_STATUSES).optional(),
  asset: assetCode.optional(),
  network: networkCode.optional(),
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
