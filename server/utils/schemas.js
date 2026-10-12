// Reusable zod building blocks for request validation.

import { z } from 'zod';
import { validateAmount, normalizeAmountInput } from '../../public/js/validation/validate-amount.js';

export const uuid = z.string().uuid('invalid');
export const assetCode = z.string().regex(/^[A-Z0-9]{2,10}$/, 'invalid');
export const networkCode = z.string().regex(/^[A-Z0-9_]{2,20}$/, 'invalid');
export const locale = z.enum(['en', 'ru', 'ar', 'ka']);
export const countryCode = z.string().regex(/^[A-Z]{2}$/, 'invalid');
export const reason = z.string().trim().min(3, 'too_short').max(1000, 'too_long');
export const txHash = z.string().trim().regex(/^(0x)?[A-Za-z0-9]{16,128}$/, 'invalid');

// Positive decimal string; precision against the asset is checked by the services.
export const amount = z
  .union([z.string(), z.number()])
  .transform((v) => normalizeAmountInput(typeof v === 'number' ? String(v) : v))
  .superRefine((v, ctx) => {
    const error = validateAmount(v);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  });

export const nonNegativeAmount = z
  .union([z.string(), z.number()])
  .transform((v) => normalizeAmountInput(typeof v === 'number' ? String(v) : v))
  .superRefine((v, ctx) => {
    const error = validateAmount(v, { allowZero: true });
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  });

// Text in the site languages. One language is enough: an empty English,
// Russian or Arabic text is filled with the first one written (English,
// Georgian, Russian, Arabic), so every reader sees something. An empty
// Georgian text is left out (Georgian readers then see the English text).
export const localizedText = (max = 2000) =>
  z
    .object({
      en: z.string().trim().max(max).optional().default(''),
      ru: z.string().trim().max(max).optional().default(''),
      ar: z.string().trim().max(max).optional().default(''),
      ka: z.string().trim().max(max).optional().default(''),
    })
    .refine((v) => Boolean(v.en || v.ru || v.ar || v.ka), { message: 'required', path: ['en'] })
    .transform(({ en, ru, ar, ka }) => {
      const first = en || ka || ru || ar;
      const out = { en: en || first, ru: ru || first, ar: ar || first };
      return ka ? { ...out, ka } : out;
    });

export const pagination = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
};

// Keyset pagination cursor: base64url JSON of {t: timestamp, id}.
export function encodeCursor(row, timeField = 'created_at') {
  if (!row) return null;
  const t = row[timeField] instanceof Date ? row[timeField].toISOString() : row[timeField];
  return Buffer.from(JSON.stringify({ t, id: String(row.id) })).toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value.t !== 'string' || typeof value.id !== 'string') return null;
    return value;
  } catch {
    return null;
  }
}

export function pageOf(rows, limit, timeField = 'created_at') {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1], timeField) : null };
}
