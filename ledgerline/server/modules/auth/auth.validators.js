import { z } from 'zod';
import { countryCode, locale } from '../../utils/schemas.js';
import { normalizeEmail, validateEmail } from '../../../public/js/validation/validate-email.js';

const email = z
  .string()
  .max(254)
  .transform(normalizeEmail)
  .superRefine((v, ctx) => {
    const error = validateEmail(v);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  });

const password = z.string().min(1, 'required').max(128, 'too_long');
const otp = z.string().regex(/^\d{6}$/, 'otp_invalid');
const mustAccept = z.literal(true, { errorMap: () => ({ message: 'must_accept' }) });

export const registerSchema = z.object({
  email,
  password,
  locale: locale.default('en'),
  countryCode,
  referralCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,12}$/, 'referral_code_invalid')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  acceptTerms: mustAccept,
  acceptPrivacy: mustAccept,
  acceptRisk: mustAccept,
});

export const loginSchema = z.object({ email, password });
export const emailOnlySchema = z.object({ email });
export const verifyEmailSchema = z.object({
  tokenHash: z.string().min(10).max(300),
  type: z.enum(['signup', 'email', 'recovery']),
});
export const resetPasswordSchema = z.object({ tokenHash: z.string().min(10).max(300), password });
export const changePasswordSchema = z.object({ currentPassword: password, newPassword: password });
export const mfaVerifySchema = z.object({ factorId: z.string().min(1).max(100), code: otp });
export const mfaCodeSchema = z.object({ code: otp });
