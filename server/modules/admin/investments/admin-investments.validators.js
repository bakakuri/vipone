import { z } from 'zod';
import { amount, assetCode, localizedText, reason, uuid } from '../../../utils/schemas.js';

const rate = z.string().regex(/^0(\.\d{1,8})?$/, 'invalid_rate');
const productFields = {
  name: localizedText(120),
  summary: localizedText(600),
  riskDisclosure: localizedText(4000),
  revenueModel: z.enum(['trading', 'staking', 'lending', 'market_making', 'other']),
  revenueModelDescription: localizedText(4000),
  termDays: z.number().int().min(1).max(3650),
  minAmount: amount,
  maxAmount: amount.nullable().optional(),
  capacity: amount.nullable().optional(),
  performanceFeeRate: rate,
  earlyExitAllowed: z.boolean(),
  earlyExitFeeRate: rate,
  riskLevel: z.enum(['low', 'medium', 'high']),
  legalStatus: z.enum(['draft', 'under_review', 'approved', 'suspended']),
  legalReference: z.string().trim().max(200).nullable().optional(),
  assets: z.array(assetCode).min(1).max(10),
};

// Partial texts are allowed while drafting; activation requires all languages.
const draftText = z.object({ en: z.string().max(4000), ru: z.string().max(4000), ar: z.string().max(4000), ka: z.string().max(4000) }).partial();

export const createProductBody = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/, 'invalid_slug'),
  ...productFields,
  name: draftText,
  summary: draftText,
  riskDisclosure: draftText,
  revenueModelDescription: draftText,
});
export const updateProductBody = z.object(productFields).partial().extend({
  name: draftText.optional(),
  summary: draftText.optional(),
  riskDisclosure: draftText.optional(),
  revenueModelDescription: draftText.optional(),
});
export const statusBody = z.object({ status: z.enum(['draft', 'active', 'paused', 'closed']) });
export const idParams = z.object({ id: uuid });
export const resultsQuery = z.object({ productId: uuid.optional() });
export const createResultBody = z
  .object({
    productId: uuid,
    asset: assetCode,
    periodStart: z.string().datetime({ offset: true }),
    periodEnd: z.string().datetime({ offset: true }),
    grossReturnRate: z.string().regex(/^-?\d{1,2}(\.\d{1,8})?$/, 'invalid_rate'),
    evidenceReference: z.string().trim().min(3).max(300),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => new Date(v.periodEnd) > new Date(v.periodStart), { message: 'period_invalid', path: ['periodEnd'] })
  .refine((v) => new Date(v.periodEnd) <= new Date(Date.now() + 60000), { message: 'period_in_future', path: ['periodEnd'] })
  .refine((v) => Number(v.grossReturnRate) > -1, { message: 'invalid_rate', path: ['grossReturnRate'] });
export const rejectBody = z.object({ reason });
