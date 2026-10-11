// Email confirmation from the emailed link. On success the user is signed in.
import { authApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, icon, replace } from '../core/dom.js';
import { query } from '../core/url.js';
import { t } from '../i18n/i18n.js';
import { alertBox } from '../components/feedback/alert.js';
import { errorMessage } from '../components/feedback/error-message.js';
import { formField, input } from '../components/forms/form-field.js';
import { setBusy } from '../components/forms/form-validation.js';
import { toast } from '../components/notifications/toast.js';

definePage({
  id: 'verify-email',
  area: 'auth',
  auth: 'none',
  namespaces: ['auth'],
  title: 'auth:verify.title',
  async render({ page }) {
    const tokenHash = query('token_hash');
    const type = ['signup', 'email'].includes(query('type')) ? query('type') : 'signup';
    if (tokenHash) history.replaceState(null, '', location.pathname);

    function resendForm() {
      const email = formField({ label: t('auth:email'), control: input({ type: 'email', name: 'email', dir: 'ltr', autocomplete: 'email' }), id: 'verify-email' });
      const btn = h('button', { class: 'btn', type: 'submit' }, t('auth:verify.resend'));
      const form = h('form', { class: 'form', novalidate: true }, email.el, btn);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setBusy(btn, true);
        try {
          await authApi.resendConfirmation(email.control.value);
          toast(t('auth:verify.resent'));
        } catch (err) {
          email.setError(errorMessage(err));
        } finally {
          setBusy(btn, false);
        }
      });
      return form;
    }

    if (!tokenHash) {
      replace(page, h('header', { class: 'auth-card__header' }, h('h1', {}, t('auth:verify.title')), h('p', {}, t('auth:verify.missingToken'))), resendForm());
      return;
    }
    replace(page, h('header', { class: 'auth-card__header' }, h('h1', {}, t('auth:verify.checking'))), h('div', { class: 'skeleton skeleton--block' }));
    try {
      await authApi.verifyEmail({ tokenHash, type });
      replace(page,
        h('div', { class: 'auth-done auth-done--success' }, icon('check-circle', { size: 'lg' })),
        h('header', { class: 'auth-card__header' }, h('h1', {}, t('auth:verify.successTitle')), h('p', {}, t('auth:verify.successText'))),
        h('a', { class: 'btn btn--primary', href: '/dashboard' }, t('auth:verify.continue')));
    } catch (err) {
      replace(page,
        h('header', { class: 'auth-card__header' }, h('h1', {}, t('auth:verify.failedTitle'))),
        alertBox({ tone: 'danger', text: ['link_expired', 'auth_failed'].includes(err.code) ? t('auth:verify.expired') : errorMessage(err) }),
        resendForm());
    }
  },
});
