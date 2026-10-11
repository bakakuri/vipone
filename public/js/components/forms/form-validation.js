// Maps server validation errors onto fields and manages submit state.
import { t } from '../../i18n/i18n.js';
import { errorMessage, fieldErrorMessage } from '../feedback/error-message.js';
import { toast } from '../notifications/toast.js';

// fields: { name: fieldApi } where the server path is "body.<name>".
export function showServerErrors(error, fields, { fallbackToast = true } = {}) {
  Object.values(fields).forEach((f) => f.setError(''));
  if (error?.code === 'validation_failed' && Array.isArray(error.details)) {
    let shown = false;
    for (const d of error.details) {
      const name = String(d.path || '').replace(/^body\./, '').split('.')[0];
      if (fields[name]) {
        fields[name].setError(fieldErrorMessage(d.code, d));
        if (!shown) fields[name].control.focus();
        shown = true;
      }
    }
    if (shown) return;
  }
  if (fallbackToast) toast(errorMessage(error), { tone: 'error' });
}

export function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
  button.setAttribute('aria-busy', String(busy));
}

export function requiredMessage() {
  return t('errors:validation.required');
}
