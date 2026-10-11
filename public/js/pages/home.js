// Home: static, translated content (pre-rendered for /ru and /ar) plus the
// live product list. Aggregate statistics appear only in live mode when the
// operator has enabled them; demo deployments never show figures.
import { publicApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { formatAmount } from '../formatting/format-currency.js';
import { formatDateTime } from '../formatting/format-date.js';
import { formatInteger } from '../formatting/format-number.js';
import { t } from '../i18n/i18n.js';
import { productCard } from '../components/finance/product-card.js';

definePage({
  id: 'home',
  area: 'public',
  namespaces: ['home', 'investments'],
  title: 'home:metaTitle',
  async render({ page }) {
    const productsSlot = page.querySelector('#home-products');
    const statsSlot = page.querySelector('#home-stats');
    const [products, stats] = await Promise.all([publicApi.products().catch(() => []), publicApi.stats().catch(() => ({ available: false }))]);
    if (productsSlot) {
      replace(productsSlot, products.length
        ? products.slice(0, 3).map((p) => productCard(p, { publicView: true }))
        : h('p', { class: 'text-muted' }, t('home:products.none')));
    }
    if (statsSlot && stats.available) {
      statsSlot.hidden = false;
      replace(statsSlot,
        h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, t('home:stats.accounts')), h('div', { class: 'stat__value' }, formatInteger(stats.accounts))),
        ...stats.assetsUnderCustody.map((a) => h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, t('home:stats.custody', { asset: a.asset })), h('div', { class: 'stat__value num' }, formatAmount(a.amount, a.asset)))),
        stats.lastReconciledAt ? h('p', { class: 'text-xs text-subtle' }, t('home:stats.reconciled', { date: formatDateTime(stats.lastReconciledAt) })) : null);
    }
  },
});
