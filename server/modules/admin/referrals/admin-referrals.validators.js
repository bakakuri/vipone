import { z } from 'zod';
import { pagination, reason, uuid } from '../../../utils/schemas.js';

export const rewardsQuery = z.object({
  status: z.enum(['pending', 'under_review', 'credited', 'cancelled']).optional(),
  search: z.string().trim().max(150).optional(),
  ...pagination,
});
export const relationshipsQuery = z.object({ search: z.string().trim().max(150).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export const idParams = z.object({ id: uuid });
export const reviewBody = z.object({ decision: z.enum(['release', 'cancel']), reason });
