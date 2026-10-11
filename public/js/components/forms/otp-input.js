// Six-digit one-time code input (authenticator or emailed code). Accepts
// paste of the full code; always left-to-right, also in Arabic.
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';

export function otpInput({ onComplete, label } = {}) {
  const inputs = Array.from({ length: 6 }, (_, i) =>
    h('input', { inputmode: 'numeric', autocomplete: i === 0 ? 'one-time-code' : 'off', maxLength: 1, 'aria-label': `${label || t('auth:mfa.codeLabel')} ${i + 1}`, pattern: '[0-9]*' }),
  );
  const wrap = h('div', { class: 'otp', dir: 'ltr' }, inputs);
  const value = () => inputs.map((i) => i.value).join('');

  inputs.forEach((input, i) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(-1);
      if (input.value && i < 5) inputs[i + 1].focus();
      if (value().length === 6) onComplete?.(value());
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && i > 0) inputs[i - 1].focus();
    });
    input.addEventListener('paste', (e) => {
      const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!digits) return;
      e.preventDefault();
      digits.split('').forEach((d, j) => {
        if (inputs[j]) inputs[j].value = d;
      });
      inputs[Math.min(digits.length, 5)].focus();
      if (digits.length === 6) onComplete?.(digits);
    });
  });

  return {
    el: wrap,
    value,
    focus: () => inputs[0].focus(),
    clear: () => {
      inputs.forEach((i) => {
        i.value = '';
      });
      inputs[0].focus();
    },
  };
}
