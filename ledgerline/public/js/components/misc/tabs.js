// Accessible tabs (arrow keys move between tabs).
import { h } from '../../core/dom.js';

export function tabs(items, { selected = items[0]?.id, onChange } = {}) {
  const list = h('div', { class: 'tabs', role: 'tablist' });
  const buttons = items.map((item) =>
    h('button', { class: 'tab', role: 'tab', type: 'button', id: `tab-${item.id}`, 'aria-controls': `panel-${item.id}`, 'aria-selected': String(item.id === selected), tabindex: item.id === selected ? '0' : '-1', dataset: { id: item.id } }, item.label),
  );
  list.append(...buttons);
  function select(id, focus = false) {
    buttons.forEach((b) => {
      const active = b.dataset.id === id;
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
      if (active && focus) b.focus();
    });
    onChange?.(id);
  }
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) select(b.dataset.id);
  });
  list.addEventListener('keydown', (e) => {
    const idx = buttons.findIndex((b) => b === document.activeElement);
    if (idx < 0) return;
    const rtl = document.documentElement.dir === 'rtl';
    const forward = e.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const backward = e.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    if (!forward && !backward) return;
    e.preventDefault();
    const next = buttons[(idx + (forward ? 1 : -1) + buttons.length) % buttons.length];
    select(next.dataset.id, true);
  });
  return { el: list, select };
}

export function segmented(options, { value, onChange, label } = {}) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label || '' });
  for (const opt of options) {
    const btn = h('button', { type: 'button', 'aria-pressed': String(opt.value === value), dataset: { value: opt.value } }, opt.label);
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      onChange?.(opt.value);
    });
    wrap.append(btn);
  }
  return wrap;
}
