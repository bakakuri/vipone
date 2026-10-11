import { z } from 'zod';
import { uuid } from '../../utils/schemas.js';

export const createBody = z.object({
  subject: z.string().trim().min(3, 'too_short').max(140, 'too_long'),
  category: z.enum(['account', 'deposit', 'withdrawal', 'investment', 'referral', 'security', 'other']),
  message: z.string().trim().min(10, 'too_short').max(5000, 'too_long'),
});
export const messageBody = z.object({ body: z.string().trim().min(1, 'required').max(5000, 'too_long') });
export const idParams = z.object({ id: uuid });
