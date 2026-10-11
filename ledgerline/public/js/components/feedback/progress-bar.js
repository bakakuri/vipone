import { h } from '../../core/dom.js';

export function progressBar(value, { label, meta } = {}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const bar = h('div', { class: 'progress__bar' });
  requestAnimationFrame(() => bar.style.setProperty('width', `${pct}%`));
  return h('div', { class: 'progress' },
    h('div', { class: 'progress__track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': label || '' }, bar),
    meta ? h('div', { class: 'progress__meta' }, ...[].concat(meta)) : null,
  );
}
