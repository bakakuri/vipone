import { z } from 'zod';
import { pagination, uuid } from '../../../utils/schemas.js';

export const listQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'executed', 'failed', 'expired']).optional(), ...pagination });
export const idParams = z.object({ id: uuid });
export const decisionBody = z.object({ note: z.string().trim().max(1000).optional() });
export const rejectBody = z.object({ note: z.string().trim().min(3, 'too_short').max(1000) });
