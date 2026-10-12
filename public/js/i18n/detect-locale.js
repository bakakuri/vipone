// Language choice: URL prefix (/ru, /ar, /ka) > saved preference > browser
// languages > English. Never inferred from IP or country.
import { getPref } from '../core/storage.js';
import { localePrefix } from '../core/url.js';
import { DEFAULT_LOCALE, SUPPORTED } from './locales.js';

export function detectLocale() {
  const fromPath = localePrefix();
  if (fromPath) return fromPath;
  const saved = getPref('locale');
  if (SUPPORTED.includes(saved)) return saved;
  for (const lang of navigator.languages || [navigator.language || DEFAULT_LOCALE]) {
    const base = String(lang).slice(0, 2).toLowerCase();
    if (SUPPORTED.includes(base)) return base;
  }
  return DEFAULT_LOCALE;
}
