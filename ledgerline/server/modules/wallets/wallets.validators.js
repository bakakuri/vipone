import { z } from 'zod';
import { assetCode, networkCode, uuid } from '../../utils/schemas.js';

export const addWalletBody = z.object({
  label: z.string().trim().min(1, 'required').max(60, 'too_long'),
  asset: assetCode,
  network: networkCode,
  address: z.string().trim().min(20, 'address_invalid').max(128, 'address_invalid'),
  memo: z.string().trim().max(64).optional().or(z.literal('')),
});
export const confirmBody = z.object({ code: z.string().regex(/^\d{6}$/, 'otp_invalid') });
export const idParams = z.object({ id: uuid });
