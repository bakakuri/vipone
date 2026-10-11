import { h, icon } from '../../core/dom.js';

export function accordion(items) {
  const root = h('div', { class: 'accordion' });
  items.forEach((item, i) => {
    const panelId = `acc-panel-${Math.random().toString(36).slice(2, 8)}-${i}`;
    const trigger = h('button', { class: 'accordion__trigger', type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId }, h('span', {}, item.title), icon('chevron-down', { size: 'sm' }));
    const panel = h('div', { class: 'accordion__panel', id: panelId, role: 'region' }, h('div', {}, h('div', { class: 'accordion__content' }, item.content)));
    trigger.addEventListener('click', () => {
      const open = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', String(!open));
      panel.classList.toggle('is-open', !open);
    });
    root.append(h('div', { class: 'accordion__item' }, trigger, panel));
  });
  return root;
}
