import { z } from 'zod';
import { amount, assetCode, networkCode, pagination, uuid } from '../../utils/schemas.js';

export const DEPOSIT_STATUSES = [
  'created', 'awaiting_payment', 'detected', 'confirming', 'confirmed', 'credited', 'failed', 'rejected', 'under_review',
];

export const listQuery = z.object({
  status: z.enum(DEPOSIT_STATUSES).optional(),
  asset: assetCode.optional(),
  ...pagination,
});
export const addressQuery = z.object({ network: networkCode });
export const requestBody = z.object({ asset: assetCode, network: networkCode, expectedAmount: amount.optional() });
export const idParams = z.object({ id: uuid });
