// "12 / 19 confirmations" with a small bar — from the server's counts.
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';

export function confirmationProgress(confirmations, required) {
  const done = Math.min(Number(confirmations) || 0, Number(required) || 0);
  const pct = required ? Math.round((done / required) * 100) : 0;
  const bar = h('div', { class: 'progress__bar' });
  bar.style.setProperty('width', `${pct}%`);
  return h('span', { class: 'confirmations' },
    h('span', { class: 'progress__track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(required), 'aria-valuenow': String(done), 'aria-label': t('deposit:confirmationsLabel') }, bar),
    h('span', { class: 'num' }, t('deposit:confirmationsShort', { done, required })));
}
