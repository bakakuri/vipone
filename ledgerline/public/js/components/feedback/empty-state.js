import { h, icon } from '../../core/dom.js';

export function emptyState({ iconName = 'ledger', title, text, action } = {}) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-state__icon' }, icon(iconName)),
    title ? h('div', { class: 'empty-state__title' }, title) : null,
    text ? h('p', {}, text) : null,
    action || null,
  );
}
