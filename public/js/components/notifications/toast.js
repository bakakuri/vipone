// Toasts confirm what just happened ("Withdrawal requested") or explain a
// failure. They disappear by themselves; errors stay longer.
import { h, icon } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { errorMessage } from '../feedback/error-message.js';

let region;

function ensureRegion() {
  if (!region) {
    region = h('div', { class: 'toast-region', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.append(region);
  }
  return region;
}

export function toast(message, { tone = 'success', title, duration } = {}) {
  const iconName = { error: 'x-circle', info: 'info', warning: 'alert' }[tone] || 'check-circle';
  const close = h('button', { class: 'toast__close', type: 'button', 'aria-label': t('common:actions.close') }, icon('x', { size: 'sm' }));
  const el = h('div', { class: `toast toast--${tone}`, role: tone === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast__icon' }, icon(iconName)),
    h('div', { class: 'toast__body' }, title ? h('div', { class: 'toast__title' }, title) : null, h('div', {}, message)),
    close,
  );
  const dismiss = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  close.addEventListener('click', dismiss);
  ensureRegion().append(el);
  setTimeout(dismiss, duration ?? (tone === 'error' ? 8000 : 4500));
  return dismiss;
}

export function toastError(error) {
  return toast(errorMessage(error), { tone: 'error' });
}
