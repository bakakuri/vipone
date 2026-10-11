import { z } from 'zod';
import { assetCode, nonNegativeAmount, pagination, reason, txHash, uuid } from '../../../utils/schemas.js';
import { WITHDRAWAL_STATUSES } from '../../withdrawals/withdrawals.validators.js';

export const listQuery = z.object({
  status: z.enum(WITHDRAWAL_STATUSES).optional(),
  asset: assetCode.optional(),
  search: z.string().trim().max(150).optional(),
  ...pagination,
});
export const idParams = z.object({ id: uuid });
export const reasonBody = z.object({ reason });
export const broadcastBody = z.object({ txHash });
export const completeBody = z.object({ actualNetworkFee: nonNegativeAmount.optional() });
export const failBody = z.object({ reason, fundsNotSent: z.literal(true, { errorMap: () => ({ message: 'must_confirm' }) }) });
