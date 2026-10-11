// Password reset request. Same answer for every email address.
import { authApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, icon, replace } from '../core/dom.js';
import { t } from '../i18n/i18n.js';
import { normalizeEmail, validateEmail } from '../validation/validate-email.js';
import { alertBox } from '../components/feedback/alert.js';
import { errorMessage, fieldErrorMessage } from '../components/feedback/error-message.js';
import { formField, input } from '../components/forms/form-field.js';
import { setBusy } from '../components/forms/form-validation.js';

definePage({
  id: 'forgot-password',
  area: 'auth',
  auth: 'guest',
  namespaces: ['auth'],
  title: 'auth:forgot.title',
  async render({ page }) {
    const email = formField({ label: t('auth:email'), control: input({ type: 'email', name: 'email', autocomplete: 'email', dir: 'ltr', maxLength: 254 }), id: 'forgot-email' });
    const notice = h('div', { 'aria-live': 'polite' });
    const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, t('auth:forgot.submit'));
    const form = h('form', { class: 'form', novalidate: true }, notice, email.el, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const address = normalizeEmail(email.control.value);
      const problem = validateEmail(address);
      email.setError(problem ? fieldErrorMessage(problem) : '');
      if (problem) return;
      setBusy(submit, true);
      try {
        await authApi.forgotPassword(address);
        replace(page,
          h('div', { class: 'auth-done' }, icon('mail', { size: 'lg' })),
          h('header', { class: 'auth-card__header' }, h('h1', {}, t('auth:forgot.sentTitle')), h('p', {}, t('auth:forgot.sentText', { email: address }))),
          h('a', { class: 'btn', href: '/login' }, t('auth:register.toLogin')));
      } catch (err) {
        replace(notice, alertBox({ tone: 'danger', text: errorMessage(err) }));
      } finally {
        setBusy(submit, false);
      }
    });
    replace(page,
      h('header', { class: 'auth-card__header' }, h('h1', {}, t('auth:forgot.title')), h('p', {}, t('auth:forgot.subtitle'))),
      form,
      h('p', { class: 'auth-card__footer' }, h('a', { href: '/login' }, t('auth:forgot.back'))));
    email.control.focus();
  },
});
