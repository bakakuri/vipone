// Supported languages. `format` is the locale used for numbers and dates:
// Arabic uses Western digits (nu-latn) for consistent financial figures.
export const LOCALES = {
  en: { name: 'English', dir: 'ltr', format: 'en-US' },
  ru: { name: 'Русский', dir: 'ltr', format: 'ru-RU' },
  ar: { name: 'العربية', dir: 'rtl', format: 'ar-u-nu-latn' },
  ka: { name: 'ქართული', dir: 'ltr', format: 'ka-GE' },
};
export const DEFAULT_LOCALE = 'en';
export const SUPPORTED = Object.keys(LOCALES);
