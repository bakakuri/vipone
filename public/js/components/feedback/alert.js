import { h, icon } from '../../core/dom.js';

const ICONS = { info: 'info', warning: 'alert', danger: 'alert', success: 'check-circle', neutral: 'info' };

export function alertBox({ tone = 'info', title, text, children, action } = {}) {
  return h('div', { class: `alert alert--${tone}`, role: tone === 'danger' ? 'alert' : 'status' },
    icon(ICONS[tone] || 'info'),
    h('div', { class: 'alert__body' }, title ? h('div', { class: 'alert__title' }, title) : null, text ? h('div', {}, text) : null, children || null),
    action || null,
  );
}
