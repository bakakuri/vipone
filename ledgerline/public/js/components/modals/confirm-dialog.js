// Confirmation for consequential actions. Resolves true/false.
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { openModal } from './modal.js';

export function confirmDialog({ title, text, confirmLabel, tone = 'primary', details } = {}) {
  return new Promise((resolve) => {
    const cancel = h('button', { class: 'btn', type: 'button' }, t('common:actions.cancel'));
    const ok = h('button', { class: `btn btn--${tone}`, type: 'button', autofocus: true }, confirmLabel || t('common:actions.confirm'));
    const modal = openModal({
      title,
      body: [text ? h('p', { class: 'text-muted' }, text) : null, details || null],
      footer: [cancel, ok],
      onClose: (result) => resolve(result === true),
    });
    cancel.addEventListener('click', () => modal.close(false));
    ok.addEventListener('click', () => modal.close(true));
  });
}

// Asks for a reason (staff actions are always justified in the audit log).
export function reasonDialog({ title, text, confirmLabel, tone = 'primary', label, extra } = {}) {
  return new Promise((resolve) => {
    const area = h('textarea', { class: 'textarea', id: 'reason-input', required: true, minLength: 3, maxLength: 1000, autofocus: true });
    const error = h('div', { class: 'field__error' });
    const cancel = h('button', { class: 'btn', type: 'button' }, t('common:actions.cancel'));
    const ok = h('button', { class: `btn btn--${tone}`, type: 'button' }, confirmLabel || t('common:actions.confirm'));
    const modal = openModal({
      title,
      body: [
        text ? h('p', { class: 'text-muted' }, text) : null,
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'reason-input' }, label || t('common:fields.reason')), area, error),
        extra?.node || null,
      ],
      footer: [cancel, ok],
      onClose: (result) => resolve(result ?? null),
    });
    cancel.addEventListener('click', () => modal.close(null));
    ok.addEventListener('click', () => {
      const value = area.value.trim();
      if (value.length < 3) {
        error.textContent = t('errors:validation.too_short');
        area.setAttribute('aria-invalid', 'true');
        return;
      }
      if (extra?.validate && !extra.validate()) return;
      modal.close(value);
    });
  });
}
