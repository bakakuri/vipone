// Investments: the user's positions (term progress, realised results,
// awaiting settlement) and the available products with their real history.
import { dashboardApi, investmentsApi, publicApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { query, setQuery } from '../core/url.js';
import { registerAssets } from '../formatting/format-currency.js';
import { formatPercent } from '../formatting/format-number.js';
import { localized, t } from '../i18n/i18n.js';
import { createActionKey } from '../services/idempotency.js';
import { liveRefresh } from '../services/live-refresh.js';
import { alertBox } from '../components/feedback/alert.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { errorMessage } from '../components/feedback/error-message.js';
import { investmentCalculator } from '../components/finance/investment-calculator.js';
import { positionCard } from '../components/finance/position-card.js';
import { productCard } from '../components/finance/product-card.js';
import { pageHeader } from '../components/misc/page-header.js';
import { segmented, tabs } from '../components/misc/tabs.js';
import { confirmDialog } from '../components/modals/confirm-dialog.js';
import { openModal } from '../components/modals/modal.js';
import { openPositionDialog } from '../components/modals/open-position-dialog.js';
import { openPositionDetail } from '../components/modals/position-detail.js';
import { toast } from '../components/notifications/toast.js';
import { helpButton } from '../components/onboarding/help-drawer.js';

const FILTERS = ['open', 'matured', 'closed_early'];

definePage({
  id: 'investments',
  area: 'app',
  namespaces: ['investments', 'transactions'],
  title: 'investments:title',
  async render({ page }) {
    const [assets, products] = await Promise.all([publicApi.assets(), investmentsApi.products()]);
    registerAssets(assets);
    let balances = (await dashboardApi.summary()).balances;
    let filter = 'open';
    let current = query('tab') === 'products' ? 'products' : 'positions';

    const positionsBody = h('div', { class: 'stack' });
    const productsBody = h('div', { class: 'product-grid' });
    const positionsPanel = h('section', { class: 'stack', id: 'panel-positions', role: 'tabpanel', 'aria-labelledby': 'tab-positions' },
      segmented(FILTERS.map((f) => ({ value: f, label: t(`investments:filters.${f}`) })), { value: filter, label: t('investments:filters.label'), onChange: (v) => { filter = v; loadPositions(); } }),
      positionsBody);
    const productsPanel = h('section', { class: 'stack', id: 'panel-products', role: 'tabpanel', 'aria-labelledby': 'tab-products' },
      alertBox({ tone: 'info', title: t('investments:howResultsTitle'), text: t('investments:howResultsText') }),
      productsBody);

    const tabBar = tabs([{ id: 'positions', label: t('investments:tabs.positions') }, { id: 'products', label: t('investments:tabs.products') }], {
      selected: current,
      onChange: (id) => {
        current = id;
        positionsPanel.hidden = id !== 'positions';
        productsPanel.hidden = id !== 'products';
        setQuery({ tab: id === 'products' ? 'products' : null });
      },
    });
    positionsPanel.hidden = current !== 'positions';
    productsPanel.hidden = current !== 'products';

    async function closeEarly(p) {
      const product = products.find((x) => x.id === p.productId);
      const ok = await confirmDialog({
        title: t('investments:close.title'),
        text: t('investments:close.text', { rate: formatPercent(product?.earlyExitFeeRate ?? 0) }),
        confirmLabel: t('investments:position.closeEarly'),
        tone: 'danger',
      });
      if (!ok) return;
      try {
        const res = await investmentsApi.closeEarly(p.id, createActionKey().get());
        toast(t('investments:close.done', { reference: res.reference }));
        loadPositions();
      } catch (err) {
        toast(errorMessage(err), { tone: 'error' });
      }
    }

    async function loadPositions() {
      const statuses = filter === 'open' ? ['active', 'awaiting_settlement'] : [filter];
      const lists = await Promise.all(statuses.map((s) => investmentsApi.positions(s)));
      const items = lists.flat();
      replace(positionsBody, items.length
        ? h('div', { class: 'position-grid' }, items.map((p) => positionCard(p, { onOpen: (x) => openPositionDetail(x.id), onClose: closeEarly })))
        : emptyState({ iconName: 'layers', title: t(`investments:empty.${filter}.title`), text: t(`investments:empty.${filter}.text`),
            action: filter === 'open' ? h('button', { class: 'btn btn--sm btn--primary', type: 'button', on: { click: () => tabBar.select('products') } }, t('investments:browse')) : null }));
    }

    function renderProducts() {
      replace(productsBody, products.length
        ? products.map((p) => productCard(p, {
            onInvest: (product) => openPositionDialog(product, { balances, onOpened: () => { tabBar.select('positions'); loadPositions(); } }),
            onCalculate: (product) => openModal({ title: t('investments:calc.title', { name: localized(product.name) }), body: investmentCalculator(product), wide: true }),
          }))
        : emptyState({ iconName: 'layers', title: t('investments:noProductsTitle'), text: t('investments:noProductsText') }));
    }

    replace(page,
      pageHeader({ title: t('investments:title'), subtitle: t('investments:subtitle'), actions: helpButton('investments') }),
      tabBar.el, positionsPanel, productsPanel);
    renderProducts();
    await loadPositions();
    liveRefresh(['position.updated'], () => loadPositions().catch(() => {}));
    liveRefresh(['balance.changed'], async () => {
      balances = (await dashboardApi.summary().catch(() => ({ balances }))).balances;
    });
  },
});
