// Amount input with asset unit and optional "max" button. Keeps the value a
// decimal string; accepts comma decimals and Arabic-Indic digits.
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { normalizeAmountInput } from '../../validation/validate-amount.js';

export function amountInput({ asset = '', max, name = 'amount', placeholder = '0.00' } = {}) {
  const control = h('input', { class: 'input num', name, inputmode: 'decimal', autocomplete: 'off', placeholder, dir: 'ltr' });
  const unit = h('span', { class: 'input-group__unit' }, asset);
  const maxBtn = max !== undefined ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, t('common:actions.max')) : null;
  maxBtn?.addEventListener('click', () => {
    control.value = typeof max === 'function' ? max() : max;
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const group = h('div', { class: 'input-group' }, control, h('div', { class: 'input-group__addon' }, maxBtn, unit));
  return {
    el: group,
    control,
    value: () => normalizeAmountInput(control.value),
    setAsset(code) {
      unit.textContent = code;
    },
  };
}
