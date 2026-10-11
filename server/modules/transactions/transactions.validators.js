import { z } from 'zod';
import { assetCode, pagination, uuid } from '../../utils/schemas.js';
import { TRANSACTION_TYPES } from './transactions.repository.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, 'invalid_date');

export const listQuery = z.object({
  type: z.enum(TRANSACTION_TYPES).optional(),
  asset: assetCode.optional(),
  status: z.string().regex(/^[a-z_]{3,30}$/).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...pagination,
});
export const idParams = z.object({ id: uuid });
