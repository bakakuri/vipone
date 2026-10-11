import { h } from '../../core/dom.js';

export function pageHeader({ title, subtitle, actions, breadcrumbs } = {}) {
  return h('header', { class: 'page-header' },
    h('div', { class: 'page-header__text' }, breadcrumbs || null, h('h1', {}, title), subtitle ? h('p', {}, subtitle) : null),
    actions ? h('div', { class: 'page-header__actions' }, actions) : null,
  );
}
