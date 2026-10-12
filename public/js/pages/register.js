// Registration: email, password (same rules as the server), country,
// optional referral code, and explicit consent to the terms, privacy policy
// and risk disclosure. The answer is the same whether or not the email is
// already registered (no account enumeration).
import { authApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, icon, replace } from '../core/dom.js';
import { query } from '../core/url.js';
import { redirectAfterLogin, setSession } from '../auth/session.js';
import { getLocale, t } from '../i18n/i18n.js';
import { countryOptions } from '../utils/countries.js';
import { checkPassword } from '../validation/password-rules.js';
import { normalizeEmail, validateEmail } from '../validation/validate-email.js';
import { alertBox } from '../components/feedback/alert.js';
import { errorMessage, fieldErrorMessage } from '../components/feedback/error-message.js';
import { checkbox, formField, input, select } from '../components/forms/form-field.js';
import { passwordField } from '../components/forms/password-field.js';
import { setBusy, showServerErrors } from '../components/forms/form-validation.js';
import { toast } from '../components/notifications/toast.js';

function consent(name, textKey, href, linkKey) {
  const box = checkbox({ name, required: true, label: '' });
  const span = box.el.querySelector('span');
  const [before, after] = t(textKey).split('{link}');
  span.append(before || '', h('a', { href, target: '_blank', rel: 'noopener' }, t(linkKey)), after || '');
  const error = h('div', { class: 'field__error', role: 'alert' });
  return { el: h('div', { class: 'field' }, box.el, error), input: box.input, setError: (m) => { error.textContent = m || ''; } };
}

definePage({
  id: 'register',
  area: 'auth',
  auth: 'guest',
  namespaces: ['auth'],
  title: 'auth:register.title',
  async render({ page }) {
    const email = formField({ label: t('auth:email'), control: input({ type: 'email', name: 'email', autocomplete: 'email', required: true, dir: 'ltr', maxLength: 254 }), id: 'reg-email' });
    const password = passwordField({ label: t('auth:password'), autocomplete: 'new-password', showRules: true, getEmail: () => email.control.value, id: 'reg-password' });
    const countries = [{ value: '', label: t('auth:register.countryPlaceholder') }, ...countryOptions(getLocale())];
    const country = formField({ label: t('auth:register.country'), control: select(countries, { name: 'countryCode', autocomplete: 'country' }), hint: t('auth:register.countryHint'), id: 'reg-country' });
    const ref = formField({
      label: t('auth:register.referral'),
      aside: t('common:optional'),
      control: input({ name: 'referralCode', value: (query('ref') || '').toUpperCase().slice(0, 12), autocomplete: 'off', dir: 'ltr', maxLength: 12, spellcheck: false }),
      id: 'reg-ref',
    });
    const terms = consent('acceptTerms', 'auth:register.acceptTerms', '/legal/terms', 'navigation:terms');
    const privacy = consent('acceptPrivacy', 'auth:register.acceptPrivacy', '/legal/privacy', 'navigation:privacy');
    const risk = consent('acceptRisk', 'auth:register.acceptRisk', '/risk-disclosure', 'navigation:risk');
    const notice = h('div', { 'aria-live': 'polite' });
    const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, t('auth:register.submit'));
    const form = h('form', { class: 'form', novalidate: true }, notice, email.el, password.el, country.el, ref.el,
      h('fieldset', { class: 'consents' }, h('legend', { class: 'field__label' }, t('auth:register.consents')), terms.el, privacy.el, risk.el),
      submit);

    function done(address) {
      const resend = h('button', { class: 'btn', type: 'button' }, t('auth:verify.resend'));
      resend.addEventListener('click', async () => {
        setBusy(resend, true);
        try {
          await authApi.resendConfirmation(address);
          toast(t('auth:verify.resent'));
        } catch (err) {
          toast(errorMessage(err), { tone: 'error' });
        } finally {
          setBusy(resend, false);
        }
      });
      replace(page,
        h('div', { class: 'auth-done' }, icon('mail', { size: 'lg' })),
        h('header', { class: 'auth-card__header' }, h('h1', {}, t('auth:register.checkEmailTitle')), h('p', {}, t('auth:register.checkEmailText', { email: address }))),
        alertBox({ tone: 'info', text: t('auth:register.checkSpam') }),
        h('div', { class: 'cluster' }, resend, h('a', { class: 'btn btn--ghost', href: '/login' }, t('auth:register.toLogin'))));
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = {
        email: normalizeEmail(email.control.value),
        password: password.control.value,
        countryCode: country.control.value,
        referralCode: ref.control.value.trim().toUpperCase(),
        locale: getLocale(),
        acceptTerms: terms.input.checked,
        acceptPrivacy: privacy.input.checked,
        acceptRisk: risk.input.checked,
      };
      const emailProblem = validateEmail(values.email);
      const pwFailed = checkPassword(values.password, values.email);
      email.setError(emailProblem ? fieldErrorMessage(emailProblem) : '');
      password.setError(pwFailed.length ? t('auth:passwordRules.notMet') : '');
      country.setError(values.countryCode ? '' : t('errors:validation.required'));
      [terms, privacy, risk].forEach((c) => c.setError(c.input.checked ? '' : t('errors:validation.must_accept')));
      if (emailProblem || pwFailed.length || !values.countryCode || !values.acceptTerms || !values.acceptPrivacy || !values.acceptRisk) {
        form.querySelector('[aria-invalid="true"], .field__error:not(:empty)')?.closest('.field')?.querySelector('input, select')?.focus();
        return;
      }
      setBusy(submit, true);
      replace(notice);
      try {
        await authApi.register(values);
        // When the auth service does not require email confirmation the new
        // account can sign in straight away; otherwise show "check your email".
        try {
          const result = await authApi.login({ email: values.email, password: values.password });
          setSession(result);
          if (!result.mfaRequired) {
            redirectAfterLogin();
            return;
          }
        } catch {
          /* email confirmation required (or the address was already registered) */
        }
        done(values.email);
      } catch (err) {
        if (err.code === 'referral_code_invalid') ref.setError(errorMessage(err));
        else if (err.code === 'country_not_supported') country.setError(errorMessage(err));
        else if (err.code === 'password_weak') password.setError(errorMessage(err));
        else showServerErrors(err, { email, password, countryCode: country, referralCode: ref, acceptTerms: terms, acceptPrivacy: privacy, acceptRisk: risk }, { fallbackToast: false });
        if (!form.querySelector('.field__error:not(:empty)')) replace(notice, alertBox({ tone: 'danger', text: errorMessage(err) }));
      } finally {
        setBusy(submit, false);
      }
    });

    replace(page,
      h('header', { class: 'auth-card__header' }, h('h1', {}, t('auth:register.title')), h('p', {}, t('auth:register.subtitle'))),
      form,
      h('p', { class: 'auth-card__footer' }, t('auth:register.haveAccount'), ' ', h('a', { href: '/login' }, t('auth:register.signIn'))));
    email.control.focus();
  },
});
