import { z } from 'zod';
import { pagination, reason, uuid } from '../../../utils/schemas.js';

export const listQuery = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'restricted', 'frozen', 'closed']).optional(),
  kyc: z.enum(['none', 'pending', 'approved', 'rejected']).optional(),
  staff: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  ...pagination,
});
export const idParams = z.object({ id: uuid });
export const statusBody = z.object({ status: z.enum(['active', 'restricted', 'frozen']), reason });
export const kycBody = z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().trim().max(500).optional() });
export const roleBody = z.object({ role: z.enum(['support', 'finance', 'compliance', 'super_admin']), action: z.enum(['grant', 'revoke']), reason });
export const flagsQuery = z.object({ status: z.enum(['open', 'resolved', 'dismissed']).optional(), ...pagination });
export const resolveBody = z.object({ resolution: z.enum(['resolved', 'dismissed']), note: reason });
