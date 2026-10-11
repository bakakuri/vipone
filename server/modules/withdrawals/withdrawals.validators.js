import { z } from 'zod';
import { amount, assetCode, pagination, uuid } from '../../utils/schemas.js';

export const WITHDRAWAL_STATUSES = ['pending', 'under_review', 'approved', 'processing', 'completed', 'rejected', 'failed', 'cancelled'];

export const quoteBody = z.object({ walletId: uuid, amount });
export const createBody = z.object({ quoteId: uuid });
export const idParams = z.object({ id: uuid });
export const listQuery = z.object({ status: z.enum(WITHDRAWAL_STATUSES).optional(), asset: assetCode.optional(), ...pagination });
