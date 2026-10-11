import { z } from 'zod';
import { assetCode, pagination } from '../../utils/schemas.js';

export const listQuery = z.object({
  kind: z.enum(['profit', 'loss', 'referral_reward']).optional(),
  asset: assetCode.optional(),
  ...pagination,
});
