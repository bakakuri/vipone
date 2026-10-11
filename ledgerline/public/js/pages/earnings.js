// Earnings: realised investment results (after performance fees) and
// referral rewards. Pending rewards are shown as pending, never as earned.
import { earningsApi, publicApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { formatAmount, registerAssets } from '../formatting/format-currency.js';
import { formatDate, formatDateTime } from '../formatting/format-date.js';
import { t } from '../i18n/i18n.js';
import { liveRefresh } from '../services/live-refresh.js';
import { alertBox } from '../components/feedback/alert.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { amount } from '../components/misc/amount-display.js';
import { pageHeader } from '../components/misc/page-header.js';
import { openTransactionDetail } from '../components/modals/transaction-detail.js';
import { helpButton } from '../components/onboarding/help-drawer.js';
import { dataTable } from '../components/tables/data-table.js';
import { filterBar } from '../components/tables/filter-bar.js';
import { loadMore } from '../components/tables/load-more.js';

const KINDS = ['profit', 'loss', 'referral_reward'];

function summaryCard(a) {
  const row = (label, value) => [h('dt', {}, label), h('dd', { class: 'num' }, value)];
  return h('section', { class: 'card', 'aria-label': a.asset },
    h('div', { class: 'card__header' }, h('h2', { class: 'card__title' }, a.asset), amount(a.realisedNet, a.asset, { sign: true, className: 'earnings-net' })),
    h('dl', { class: 'kv' },
      row(t('earnings:realisedProfit'), formatAmount(a.realisedProfit, a.asset)),
      row(t('earnings:realisedLoss'), formatAmount(a.realisedLoss, a.asset)),
      row(t('earnings:performanceFees'), formatAmount(a.performanceFees, a.asset)),
      row(t('earnings:referralCredited'), formatAmount(a.referralCredited, a.asset)),
      row(t('earnings:referralPending'), formatAmount(a.referralPending, a.asset))));
}

definePage({
  id: 'earnings',
  area: 'app',
  namespaces: ['earnings', 'transactions', 'investments'],
  title: 'earnings:title',
  async render({ page }) {
    registerAssets(await publicApi.assets());
    const summaryBody = h('div', { class: 'grid grid--3' });
    const awaiting = h('div');
    let filters = {};

    const table = dataTable({
      columns: [
        { key: 'kind', label: t('earnings:kind'), primary: true, render: (r) => t(`earnings:kinds.${r.kind}`) },
        { key: 'amount', label: t('common:fields.amount'), align: 'end', render: (r) => amount(r.amount, r.asset, { sign: true, tone: r.status === 'confirmed' }) },
        { key: 'status', label: t('transactions:status'), render: (r) => statusBadge(r.status) },
        { key: 'source', label: t('earnings:source'), render: (r) => (r.positionReference
          ? h('span', {}, h('bdi', { class: 'mono text-xs', dir: 'ltr' }, r.positionReference), h('span', { class: 'text-xs text-subtle' }, ` ${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}`))
          : r.status === 'pending' && r.releaseAt ? h('span', { class: 'text-xs text-subtle' }, t('earnings:releaseAt', { date: formatDateTime(r.releaseAt) })) : t('earnings:kinds.referral_reward')) },
        { key: 'date', label: t('transactions:date'), render: (r) => formatDateTime(r.createdAt) },
      ],
      onRowClick: (r) => r.ledgerTransactionId && openTransactionDetail({ ...r, type: r.kind, postedAt: r.createdAt, reference: r.positionReference }),
      empty: emptyState({ iconName: 'earnings', title: t('earnings:emptyTitle'), text: t('earnings:emptyText') }),
      caption: t('earnings:historyTitle'),
    });
    const more = loadMore({
      onLoad: async (cursor) => {
        const res = await earningsApi.list({ ...filters, cursor });
        table.update(res.items, { append: true });
        more.setCursor(res.nextCursor);
      },
    });
    const bar = filterBar({
      fields: [{ name: 'kind', type: 'select', label: t('earnings:kind'), options: KINDS.map((k) => ({ value: k, label: t(`earnings:kinds.${k}`) })) }],
      onChange: (v) => {
        filters = v;
        loadList();
      },
    });
    filters = bar.values();

    async function loadList() {
      const res = await earningsApi.list(filters);
      table.update(res.items);
      more.setCursor(res.nextCursor);
    }
    async function loadSummary() {
      const s = await earningsApi.summary();
      replace(summaryBody, s.perAsset.length ? s.perAsset.map(summaryCard) : emptyState({ iconName: 'earnings', title: t('earnings:emptyTitle'), text: t('earnings:emptyText') }));
      replace(awaiting, s.awaitingSettlement ? alertBox({ tone: 'info', text: t('earnings:awaiting', { count: s.awaitingSettlement }) }) : null);
    }

    replace(page,
      pageHeader({ title: t('earnings:title'), subtitle: t('earnings:subtitle'), actions: helpButton('earnings') }),
      alertBox({ tone: 'neutral', text: t('earnings:realisedOnly') }),
      awaiting,
      summaryBody,
      h('section', { class: 'stack', 'aria-labelledby': 'earnings-history' }, h('h2', { class: 'section-title', id: 'earnings-history' }, t('earnings:historyTitle')), bar.el, table.el, more.el));
    await Promise.all([loadSummary(), loadList()]);
    liveRefresh(['position.updated', 'referral.updated', 'balance.changed'], () => Promise.all([loadSummary(), loadList()]).catch(() => {}));
  },
});
