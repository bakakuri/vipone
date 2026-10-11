import { z } from 'zod';
import { locale } from '../../utils/schemas.js';

export const preferencesBody = z
  .object({
    locale: locale.optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'empty');

export const onboardingBody = z
  .object({
    completed: z.boolean().optional(),
    dismissed: z.boolean().optional(),
    step: z.number().int().min(0).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'empty');
