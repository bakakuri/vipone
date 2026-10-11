import { h, icon } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';

export function brand(href = '/') {
  return h('a', { class: 'brand', href, 'aria-label': t('common:brand') }, icon('brand', { className: 'brand__mark' }), h('span', {}, t('common:brand')));
}
