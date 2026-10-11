import { z } from 'zod';
import { amount, assetCode, uuid } from '../../utils/schemas.js';

export const openBody = z.object({
  productId: uuid,
  asset: assetCode,
  amount,
  termsVersion: z.number().int().positive(),
  acceptRisk: z.literal(true, { errorMap: () => ({ message: 'must_accept' }) }),
});
export const idParams = z.object({ id: uuid });
export const listQuery = z.object({ status: z.enum(['active', 'awaiting_settlement', 'matured', 'closed_early']).optional() });
