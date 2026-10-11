import { h } from '../../core/dom.js';
import { statusLabel, statusTone } from '../../formatting/format-transaction-status.js';

export function statusBadge(status, { label } = {}) {
  return h('span', { class: `badge badge--${statusTone(status)}`, dataset: { status } }, label ?? statusLabel(status));
}
