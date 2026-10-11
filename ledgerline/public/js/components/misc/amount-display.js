import { h } from '../../core/dom.js';
import { formatAmount, isNegative, isZero } from '../../formatting/format-currency.js';

export function amount(value, asset, { sign = false, tone = sign, className = '' } = {}) {
  const negative = isNegative(value);
  const toneClass = tone && !isZero(value) ? (negative ? 'amount--negative' : 'amount--positive') : '';
  return h('bdi', { class: `amount ${toneClass} ${className}`.trim(), dir: 'ltr' }, formatAmount(value, asset, { sign }));
}
