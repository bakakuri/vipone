import { h } from '../../core/dom.js';

export function skeletonRows(count = 4) {
  return h('div', { class: 'stack stack--sm', 'aria-busy': 'true' }, Array.from({ length: count }, () => h('span', { class: 'skeleton skeleton--row' })));
}

export function skeletonBlock() {
  return h('span', { class: 'skeleton skeleton--block', 'aria-hidden': 'true' });
}

export function skeletonText(width = '60%') {
  const el = h('span', { class: 'skeleton skeleton--text' });
  el.style.setProperty('width', width);
  return el;
}
