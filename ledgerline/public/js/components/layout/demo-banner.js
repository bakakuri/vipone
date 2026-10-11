// Shown on every page of a demo deployment so nobody mistakes test data for
// real money.
import { h, icon } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';

export function demoBanner(config) {
  if (config?.mode !== 'demo') return null;
  return h('div', { class: 'demo-banner', role: 'note' }, icon('info'), h('span', {}, t('common:demo.banner')));
}
