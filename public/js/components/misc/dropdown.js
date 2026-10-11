// Disclosure menu (language, theme, profile, notifications panel).
import { h } from '../../core/dom.js';

let openMenu = null;

document.addEventListener('click', (e) => {
  if (openMenu && !openMenu.root.contains(e.target)) openMenu.close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openMenu) {
    const trigger = openMenu.trigger;
    openMenu.close();
    trigger.focus();
  }
});

export function dropdown({ trigger, content, className = '', onOpen }) {
  const menu = h('div', { class: `dropdown__menu ${className}`.trim(), hidden: true });
  const root = h('div', { class: 'dropdown' }, trigger, menu);
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');

  const api = {
    root,
    trigger,
    menu,
    open() {
      if (openMenu && openMenu !== api) openMenu.close();
      menu.replaceChildren(...[].concat(typeof content === 'function' ? content(api) : content));
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      openMenu = api;
      onOpen?.(api);
      menu.querySelector('button, a')?.focus({ preventScroll: true });
    },
    close() {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (openMenu === api) openMenu = null;
    },
  };
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) api.open();
    else api.close();
  });
  return api;
}
