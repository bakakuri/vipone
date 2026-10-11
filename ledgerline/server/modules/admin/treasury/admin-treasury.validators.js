import { z } from 'zod';
import { amount, assetCode, nonNegativeAmount } from '../../../utils/schemas.js';

const evidence = z.string().trim().min(3, 'too_short').max(300);
export const reconcileBody = z.object({ asset: assetCode, observedCustody: nonNegativeAmount, observedStrategy: nonNegativeAmount, evidence, notes: z.string().max(1000).optional() });
export const transferBody = z
  .object({ asset: assetCode, from: z.enum(['custody', 'strategy']), to: z.enum(['custody', 'strategy']), amount, evidence })
  .refine((v) => v.from !== v.to, { message: 'same_account', path: ['to'] });
export const capitalBody = z.object({ asset: assetCode, amount, evidence });
export const assetQuery = z.object({ asset: assetCode.optional() });
