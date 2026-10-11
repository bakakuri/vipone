// Public product list with realised history and a "what if" calculator.
import { publicApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { registerAssets } from '../formatting/format-currency.js';
import { localized, t } from '../i18n/i18n.js';
import { investmentCalculator } from '../components/finance/investment-calculator.js';
import { productCard } from '../components/finance/product-card.js';
import { openModal } from '../components/modals/modal.js';
import { errorState } from '../components/feedback/error-state.js';

definePage({
  id: 'products',
  area: 'public',
  namespaces: ['investments', 'public'],
  title: 'public:products.metaTitle',
  async render({ page }) {
    const slot = page.querySelector('#products-list');
    try {
      const [assets, products] = await Promise.all([publicApi.assets(), publicApi.products()]);
      registerAssets(assets);
      replace(slot, products.length
        ? products.map((p) => productCard(p, {
            publicView: true,
            onCalculate: (product) => openModal({ title: t('investments:calc.title', { name: localized(product.name) }), body: investmentCalculator(product), wide: true }),
          }))
        : h('p', { class: 'text-muted' }, t('public:products.none')));
    } catch (err) {
      replace(slot, errorState(err, { onRetry: () => location.reload() }));
    }
  },
});
