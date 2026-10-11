// New password from the emailed link (token_hash). After the change every
// other session is signed out and the user is signed in here.
import { authApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { query } from '../core/url.js';
import { t } from '../i18n/i18n.js';
import { checkPassword } from '../validation/password-rules.js';
import { alertBox } from '../components/feedback/alert.js';
import { errorMessage } from '../components/feedback/error-message.js';
import { passwordField } from '../components/forms/password-field.js';
import { setBusy } from '../components/forms/form-validation.js';

definePage({
  id: 'reset-password',
  area: 'auth',
  auth: 'none',
  namespaces: ['auth', 'security'],
  title: 'auth:reset.title',
  async render({ page }) {
    const tokenHash = query('token_hash');
    // Remove the token from the address bar and from history.
    if (tokenHash) history.replaceState(null, '', location.pathname);
    const header = h('header', { class: 'auth-card__header' }, h('h1', {}, t('auth:reset.title')), h('p', {}, t('auth:reset.subtitle')));
    if (!tokenHash) {
      replace(page, header, alertBox({ tone: 'warning', text: t('auth:reset.missingToken') }), h('a', { class: 'btn', href: '/forgot-password' }, t('auth:reset.requestNew')));
      return;
    }
    const password = passwordField({ label: t('security:password.new'), autocomplete: 'new-password', showRules: true, id: 'reset-password' });
    const notice = h('div', { 'aria-live': 'polite' });
    const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, t('auth:reset.submit'));
    const form = h('form', { class: 'form', novalidate: true }, notice, password.el, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const failed = checkPassword(password.control.value, '');
      password.setError(failed.length ? t('auth:passwordRules.notMet') : '');
      if (failed.length) return;
      setBusy(submit, true);
      try {
        await authApi.resetPassword({ tokenHash, password: password.control.value });
        replace(page,
          h('header', { class: 'auth-card__header' }, h('h1', {}, t('auth:reset.doneTitle')), h('p', {}, t('auth:reset.doneText'))),
          h('a', { class: 'btn btn--primary', href: '/dashboard' }, t('auth:reset.continue')));
      } catch (err) {
        const expired = ['link_expired', 'auth_failed'].includes(err.code);
        replace(notice, alertBox({ tone: 'danger', text: expired ? t('auth:reset.expired') : errorMessage(err),
          action: expired ? h('a', { class: 'btn btn--sm', href: '/forgot-password' }, t('auth:reset.requestNew')) : null }));
      } finally {
        setBusy(submit, false);
      }
    });
    replace(page, header, form);
    password.control.focus();
  },
});
