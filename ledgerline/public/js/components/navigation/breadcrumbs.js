import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';

export function breadcrumbs(items) {
  return h('nav', { class: 'breadcrumbs', 'aria-label': t('navigation:breadcrumbs') },
    h('ol', {}, items.map((item, i) => h('li', {}, i === items.length - 1 ? h('span', { 'aria-current': 'page' }, item.label) : h('a', { href: item.href }, item.label)))),
  );
}
