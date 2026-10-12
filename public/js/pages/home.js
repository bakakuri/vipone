// Home: static, translated content (pre-rendered for /ru, /ar and /ka) plus the
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

// The headline writes itself in word by word (CSS animation per word).
function splitHeadline(el) {
  if (!el || el.classList.contains('is-split')) return;
  const text = el.textContent.trim().replace(/\s+/g, ' ');
  el.setAttribute('aria-label', text);
  const words = text.split(' ');
  replace(el, ...words.map((word, i) => h('span', { class: 'hero__word', 'aria-hidden': 'true', style: { '--i': String(i) } }, i < words.length - 1 ? `${word} ` : word)));
  el.classList.add('is-split');
}

definePage({
  id: 'home',
  area: 'public',
  namespaces: ['home', 'investments'],
  title: 'home:metaTitle',
  async render({ page }) {
    splitHeadline(page.querySelector('.hero__title'));
    const productsSlot = page.querySelector('#home-products');
    const statsSlot = page.querySelector('#home-stats');
    const [products, stats] = await Promise.all([publicApi.products().catch(() => []), publicApi.stats().catch(() => ({ available: false }))]);
    // The products section appears only when a product is open.
    const productsSection = page.querySelector('#home-products-section');
    if (productsSlot && products.length) {
      replace(productsSlot, products.slice(0, 3).map((p) => productCard(p, { publicView: true })));
      if (productsSection) productsSection.hidden = false;
    }
    if (statsSlot && stats.available && productsSection && !productsSection.hidden) {
      statsSlot.hidden = false;
      replace(statsSlot,
        h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, t('home:stats.accounts')), h('div', { class: 'stat__value' }, formatInteger(stats.accounts))),
        ...stats.assetsUnderCustody.map((a) => h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, t('home:stats.custody', { asset: a.asset })), h('div', { class: 'stat__value num' }, formatAmount(a.amount, a.asset)))),
        stats.lastReconciledAt ? h('p', { class: 'text-xs text-subtle' }, t('home:stats.reconciled', { date: formatDateTime(stats.lastReconciledAt) })) : null);
    }
  },
});
