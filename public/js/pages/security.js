// Security: two-factor authentication (authenticator app), password change,
// and recent security events on the account.
import { authApi, profileApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, icon, replace } from '../core/dom.js';
import { formatDateTime, formatRelative } from '../formatting/format-date.js';
import { t } from '../i18n/i18n.js';
import { alertBox } from '../components/feedback/alert.js';
import { errorMessage } from '../components/feedback/error-message.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { otpInput } from '../components/forms/otp-input.js';
import { passwordField } from '../components/forms/password-field.js';
import { setBusy, showServerErrors } from '../components/forms/form-validation.js';
import { copyButton } from '../components/misc/copy-button.js';
import { pageHeader } from '../components/misc/page-header.js';
import { qrCode } from '../components/misc/qr-code.js';
import { withMfa } from '../components/modals/mfa-dialog.js';
import { openModal } from '../components/modals/modal.js';
import { toast } from '../components/notifications/toast.js';

const EVENT_ICON = { login_success: 'key', login_failed: 'alert', new_device: 'monitor', password_changed: 'lock', mfa_enabled: 'shield', mfa_disabled: 'shield', wallet_added: 'wallet', wallet_confirmed: 'wallet', wallet_removed: 'wallet' };

function enrollDialog(onDone) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'text-muted' }, t('common:loading')));
  const modal = openModal({ title: t('security:mfa.enrollTitle'), body, wide: true });
  authApi.mfaEnroll().then((enrollment) => {
    const error = h('div', { class: 'field__error', role: 'alert' });
    let busy = false;
    const otp = otpInput({
      onComplete: async (code) => {
        if (busy) return;
        busy = true;
        try {
          await authApi.mfaVerify(enrollment.factorId, code);
          modal.close();
          toast(t('security:mfa.enabled'));
          onDone();
        } catch (err) {
          error.textContent = errorMessage(err);
          otp.clear();
        } finally {
          busy = false;
        }
      },
    });
    const grouped = enrollment.secret.replace(/(.{4})/g, '$1 ').trim();
    replace(body,
      h('ol', { class: 'enroll-steps' },
        h('li', {}, t('security:mfa.step1')),
        h('li', {}, t('security:mfa.step2'),
          h('div', { class: 'enroll-qr' }, qrCode(enrollment.uri, { label: t('security:mfa.qrLabel') })),
          h('div', { class: 'stack stack--sm' }, h('span', { class: 'text-small text-muted' }, t('security:mfa.manual')),
            h('div', { class: 'address' }, h('bdi', { class: 'address__value', dir: 'ltr' }, grouped), copyButton(enrollment.secret)))),
        h('li', {}, t('security:mfa.step3'), otp.el, error)),
      alertBox({ tone: 'warning', text: t('security:mfa.backupWarning') }));
    otp.focus();
  }).catch((err) => replace(body, alertBox({ tone: 'danger', text: errorMessage(err) })));
}

function disableDialog(onDone) {
  const error = h('div', { class: 'field__error', role: 'alert' });
  let busy = false;
  const otp = otpInput({
    onComplete: async (code) => {
      if (busy) return;
      busy = true;
      try {
        await withMfa(() => authApi.mfaDisable(code));
        modal.close();
        toast(t('security:mfa.disabled'));
        onDone();
      } catch (err) {
        error.textContent = errorMessage(err);
        otp.clear();
      } finally {
        busy = false;
      }
    },
  });
  const modal = openModal({
    title: t('security:mfa.disableTitle'),
    body: [alertBox({ tone: 'warning', text: t('security:mfa.disableWarning') }), h('p', { class: 'text-muted' }, t('security:mfa.disableText')), otp.el, error],
  });
  otp.focus();
}

definePage({
  id: 'security',
  area: 'app',
  namespaces: ['security', 'auth'],
  title: 'security:title',
  async render({ page, user, session }) {
    const mfaSlot = h('div', { class: 'stack stack--sm' });
    const eventsSlot = h('ol', { class: 'timeline' });

    function renderMfa(enabled) {
      const btn = enabled
        ? h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => disableDialog(() => renderMfa(false)) } }, t('security:mfa.disable'))
        : h('button', { class: 'btn btn--sm btn--primary', type: 'button', on: { click: () => enrollDialog(() => location.reload()) } }, icon('shield', { size: 'sm' }), t('security:mfa.enable'));
      replace(mfaSlot,
        h('div', { class: 'cluster cluster--between' },
          h('div', { class: 'cluster' }, h('span', {}, t('security:mfa.status')), statusBadge(enabled ? 'enabled' : 'disabled', { label: t(enabled ? 'security:mfa.on' : 'security:mfa.off') })),
          btn),
        h('p', { class: 'text-small text-muted' }, t(enabled ? 'security:mfa.onText' : 'security:mfa.offText')),
        enabled && session.aal === 'aal2' ? h('p', { class: 'text-xs text-subtle' }, t('security:mfa.verifiedSession')) : null);
    }
    renderMfa(user.mfaEnabled);

    const current = passwordField({ label: t('security:password.current'), name: 'currentPassword', autocomplete: 'current-password' });
    const next = passwordField({ label: t('security:password.new'), name: 'newPassword', autocomplete: 'new-password', showRules: true, getEmail: () => user.email });
    const save = h('button', { class: 'btn btn--primary', type: 'submit' }, t('security:password.change'));
    const pwForm = h('form', { class: 'form', novalidate: true }, current.el, next.el, h('p', { class: 'text-xs text-subtle' }, t('security:password.signsOut')), h('div', { class: 'cluster' }, save));
    pwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setBusy(save, true);
      try {
        await withMfa(() => authApi.changePassword({ currentPassword: current.control.value, newPassword: next.control.value }));
        pwForm.reset();
        toast(t('security:password.changed'));
      } catch (err) {
        if (err.code === 'invalid_credentials') current.setError(t('security:password.wrongCurrent'));
        else showServerErrors(err, { currentPassword: current, newPassword: next });
      } finally {
        setBusy(save, false);
      }
    });

    async function loadEvents() {
      const events = await profileApi.securityEvents();
      replace(eventsSlot, events.length
        ? events.map((e) => h('li', { class: 'timeline__item is-done' },
            h('span', { class: 'timeline__dot', 'aria-hidden': 'true' }),
            h('div', {},
              h('div', { class: 'timeline__title cluster' }, icon(EVENT_ICON[e.eventType] || 'activity', { size: 'sm' }), t(`security:events.${e.eventType}`)),
              h('div', { class: 'timeline__meta' }, h('time', { datetime: e.createdAt, title: formatDateTime(e.createdAt) }, formatRelative(e.createdAt)), e.userAgent ? ` · ${e.userAgent.slice(0, 80)}` : ''))))
        : h('li', { class: 'text-small text-muted' }, t('security:noEvents')));
    }

    replace(page,
      pageHeader({ title: t('security:title'), subtitle: t('security:subtitle') }),
      alertBox({ tone: 'info', title: t('security:neverAsk.title'), text: t('security:neverAsk.text') }),
      h('div', { class: 'grid grid--2' },
        h('section', { class: 'card', 'aria-labelledby': 'sec-mfa' }, h('h2', { class: 'card__title', id: 'sec-mfa' }, t('security:mfa.title')), mfaSlot),
        h('section', { class: 'card', 'aria-labelledby': 'sec-pw' }, h('h2', { class: 'card__title', id: 'sec-pw' }, t('security:password.title')), pwForm)),
      h('section', { class: 'card', 'aria-labelledby': 'sec-events' },
        h('h2', { class: 'card__title', id: 'sec-events' }, t('security:eventsTitle')),
        h('p', { class: 'text-xs text-subtle' }, t('security:eventsHint')),
        eventsSlot));
    await loadEvents();
  },
});
