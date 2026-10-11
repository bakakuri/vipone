// Sign in: email + password, then the authenticator code when two-factor
// authentication is on. Errors never reveal whether an email is registered.
import { authApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { query } from '../core/url.js';
import { redirectAfterLogin, setSession } from '../auth/session.js';
import { t } from '../i18n/i18n.js';
import { normalizeEmail, validateEmail } from '../validation/validate-email.js';
import { alertBox } from '../components/feedback/alert.js';
import { errorMessage, fieldErrorMessage } from '../components/feedback/error-message.js';
import { formField, input } from '../components/forms/form-field.js';
import { otpInput } from '../components/forms/otp-input.js';
import { passwordField } from '../components/forms/password-field.js';
import { setBusy } from '../components/forms/form-validation.js';
import { toast } from '../components/notifications/toast.js';

definePage({
  id: 'login',
  area: 'auth',
  auth: 'guest',
  namespaces: ['auth'],
  title: 'auth:login.title',
  async render({ page, session }) {
    const header = (title, text) => h('header', { class: 'auth-card__header' }, h('h1', {}, title), text ? h('p', {}, text) : null);

    function mfaStep() {
      const error = h('div', { class: 'field__error', role: 'alert' });
      let busy = false;
      const otp = otpInput({
        onComplete: async (code) => {
          if (busy) return;
          busy = true;
          error.textContent = '';
          try {
            const next = await authApi.mfaChallenge(code);
            setSession(next);
            redirectAfterLogin();
          } catch (err) {
            error.textContent = errorMessage(err);
            otp.clear();
          } finally {
            busy = false;
          }
        },
      });
      replace(page,
        header(t('auth:mfa.challengeTitle'), t('auth:mfa.challengeText')),
        otp.el, error,
        h('p', { class: 'auth-card__footer' }, t('auth:mfa.lostDevice'), ' ', h('a', { href: '/help#security' }, t('auth:mfa.lostDeviceLink'))));
      otp.focus();
    }

    // A session that signed in with the password but still needs the code.
    if (session?.authenticated && session.mfaRequired) {
      mfaStep();
      return;
    }

    const email = formField({ label: t('auth:email'), control: input({ type: 'email', name: 'email', autocomplete: 'username', required: true, dir: 'ltr', maxLength: 254 }), id: 'login-email' });
    const password = passwordField({ label: t('auth:password'), autocomplete: 'current-password', id: 'login-password' });
    const forgot = h('p', { class: 'text-small text-end' }, h('a', { href: '/forgot-password' }, t('auth:forgotLink')));
    const notice = h('div', { 'aria-live': 'polite' });
    const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, t('auth:login.submit'));
    const form = h('form', { class: 'form', novalidate: true }, notice, email.el, password.el, forgot, submit);

    if (query('verified') === '1') replace(notice, alertBox({ tone: 'success', text: t('auth:verify.successShort') }));
    if (query('reset') === '1') replace(notice, alertBox({ tone: 'success', text: t('auth:reset.successShort') }));
    if (query('expired') === '1') replace(notice, alertBox({ tone: 'info', text: t('auth:login.sessionExpired') }));

    function resendAction(address) {
      const btn = h('button', { class: 'btn btn--sm', type: 'button' }, t('auth:verify.resend'));
      btn.addEventListener('click', async () => {
        setBusy(btn, true);
        try {
          await authApi.resendConfirmation(address);
          toast(t('auth:verify.resent'));
        } catch (err) {
          toast(errorMessage(err), { tone: 'error' });
        } finally {
          setBusy(btn, false);
        }
      });
      return btn;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const address = normalizeEmail(email.control.value);
      const emailProblem = validateEmail(address);
      email.setError(emailProblem ? fieldErrorMessage(emailProblem) : '');
      password.setError(password.control.value ? '' : t('errors:validation.required'));
      if (emailProblem || !password.control.value) {
        form.querySelector('[aria-invalid="true"]')?.focus();
        return;
      }
      setBusy(submit, true);
      replace(notice);
      try {
        const result = await authApi.login({ email: address, password: password.control.value });
        setSession(result);
        if (result.mfaRequired) mfaStep();
        else redirectAfterLogin();
      } catch (err) {
        if (err.code === 'email_not_confirmed') {
          replace(notice, alertBox({ tone: 'warning', title: t('auth:verify.pendingTitle'), text: t('auth:verify.pendingText'), action: resendAction(address) }));
        } else {
          replace(notice, alertBox({ tone: 'danger', text: errorMessage(err) }));
        }
        password.control.value = '';
      } finally {
        setBusy(submit, false);
      }
    });

    replace(page,
      header(t('auth:login.title'), t('auth:login.subtitle')),
      form,
      h('p', { class: 'auth-card__footer' }, t('auth:login.noAccount'), ' ', h('a', { href: `/register${location.search}` }, t('auth:login.createAccount'))));
    email.control.focus();
  },
});
