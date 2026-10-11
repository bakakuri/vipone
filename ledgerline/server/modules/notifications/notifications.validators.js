import { z } from 'zod';
import { pagination, uuid } from '../../utils/schemas.js';

export const listQuery = z.object({
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  ...pagination,
});
export const idParams = z.object({ id: uuid });
