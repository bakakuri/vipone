// Staff action button: optional confirmation or written reason (stored in the
// audit log), busy state, translated errors, step-up 2FA when required.
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { errorMessage } from '../feedback/error-message.js';
import { setBusy } from '../forms/form-validation.js';
import { confirmDialog, reasonDialog } from '../modals/confirm-dialog.js';
import { withMfa } from '../modals/mfa-dialog.js';
import { toast } from '../notifications/toast.js';

export function actionButton(label, { tone = '', reason = false, confirm = null, run, done, onDone, size = 'sm' } = {}) {
  const btn = h('button', { class: ['btn', size ? `btn--${size}` : '', tone ? `btn--${tone}` : ''].filter(Boolean).join(' '), type: 'button' }, label);
  btn.addEventListener('click', async () => {
    let input = null;
    if (reason) {
      input = await reasonDialog({ title: label, text: typeof reason === 'string' ? reason : undefined, confirmLabel: label, tone: tone === 'danger' ? 'danger' : 'primary' });
      if (input === null) return;
    } else if (confirm) {
      if (!(await confirmDialog({ title: label, text: confirm, confirmLabel: label, tone: tone === 'danger' ? 'danger' : 'primary' }))) return;
    }
    setBusy(btn, true);
    try {
      const result = await withMfa(() => run(input));
      if (result?.applied === false && result.approval) toast(t('admin:approvalCreated'), { tone: 'info' });
      else toast(done || t('admin:done'));
      await onDone?.(result);
    } catch (err) {
      toast(errorMessage(err), { tone: 'error' });
    } finally {
      setBusy(btn, false);
    }
  });
  return btn;
}
