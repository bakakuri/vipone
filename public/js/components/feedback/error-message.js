// Translates an API error code into a sentence that says what happened and
// what to do. Unknown codes fall back to a generic message.
import { has, t } from '../../i18n/i18n.js';

export function errorMessage(error) {
  if (!error) return t('errors:generic');
  const code = error.code || 'generic';
  const value = error.details?.value;
  if (has(`errors:codes.${code}`)) return t(`errors:codes.${code}`, { value: value ?? '' });
  if (code === 'validation_failed') return t('errors:codes.validation_failed');
  return t('errors:generic');
}

export function fieldErrorMessage(code, params) {
  return has(`errors:validation.${code}`) ? t(`errors:validation.${code}`, params) : t('errors:validation.invalid');
}
