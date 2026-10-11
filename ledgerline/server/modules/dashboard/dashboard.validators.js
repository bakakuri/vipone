import { z } from 'zod';
import { assetCode } from '../../utils/schemas.js';

export const historyQuery = z.object({ asset: assetCode, days: z.coerce.number().int().min(7).max(365).default(30) });
