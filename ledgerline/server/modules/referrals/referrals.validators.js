import { z } from 'zod';
import { pagination } from '../../utils/schemas.js';

export const rewardsQuery = z.object({ status: z.enum(['pending', 'under_review', 'credited', 'cancelled']).optional(), ...pagination });
