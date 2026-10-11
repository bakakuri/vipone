import { z } from 'zod';
import { amount, assetCode, networkCode, reason, uuid } from '../../../utils/schemas.js';

export const keyParams = z.object({ key: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/) });
export const changeBody = z.object({ value: z.any(), reason });
export const feeRuleBody = z.object({
  asset: assetCode.nullable().optional(),
  network: networkCode.nullable().optional(),
  rate: z.string().regex(/^0(\.\d{1,8})?$/, 'invalid_rate'),
  minFee: z.string().regex(/^\d+(\.\d{1,18})?$/).optional(),
  effectiveFrom: z.string().datetime().optional(),
  reason,
});
export const adjustmentBody = z.object({
  userId: uuid,
  asset: assetCode,
  direction: z.enum(['credit_user', 'debit_user']),
  amount,
  reason,
});
