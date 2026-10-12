import { z } from 'zod';
import { amount, assetCode, networkCode, pagination, uuid } from '../../utils/schemas.js';

export const WITHDRAWAL_STATUSES = ['pending', 'under_review', 'approved', 'processing', 'completed', 'rejected', 'failed', 'cancelled'];

// Either a saved address (walletId) or an address typed in the form.
export const quoteBody = z
  .object({
    walletId: uuid.optional(),
    asset: assetCode.optional(),
    network: networkCode.optional(),
    address: z.string().trim().min(10, 'address_invalid').max(128, 'address_invalid').optional(),
    memo: z.string().trim().max(64).optional(),
    amount,
  })
  .superRefine((v, ctx) => {
    if (v.walletId) return;
    for (const key of ['asset', 'network', 'address']) {
      if (!v[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'required' });
    }
  });
export const createBody = z.object({ quoteId: uuid });
export const idParams = z.object({ id: uuid });
export const listQuery = z.object({ status: z.enum(WITHDRAWAL_STATUSES).optional(), asset: assetCode.optional(), ...pagination });
