// Deposit page: personal address per network, rules before sending, and the
// list of deposits with live confirmation progress.
import { depositsApi, publicApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { formatAmount, registerAssets } from '../formatting/format-currency.js';
import { formatDateTime } from '../formatting/format-date.js';
import { t } from '../i18n/i18n.js';
import { liveRefresh } from '../services/live-refresh.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { confirmationProgress } from '../components/finance/confirmation-progress.js';
import { statusTimeline } from '../components/finance/status-timeline.js';
import { depositForm } from '../components/forms/deposit-form.js';
import { inlineHash } from '../components/misc/address-display.js';
import { pageHeader } from '../components/misc/page-header.js';
import { openDepositDetail } from '../components/modals/deposit-detail.js';
import { helpButton } from '../components/onboarding/help-drawer.js';
import { dataTable } from '../components/tables/data-table.js';
import { filterBar } from '../components/tables/filter-bar.js';
import { loadMore } from '../components/tables/load-more.js';

const STATUSES = ['awaiting_payment', 'detected', 'confirming', 'under_review', 'credited', 'failed', 'rejected'];

definePage({
  id: 'deposit',
  area: 'app',
  namespaces: ['deposit', 'transactions'],
  title: 'deposit:title',
  async render({ page, config }) {
    const assets = await publicApi.assets();
    registerAssets(assets);
    const holdDays = config.depositHoldDays ?? 7;

    const table = dataTable({
      columns: [
        { key: 'asset', label: t('common:fields.asset'), primary: true, render: (d) => h('span', {}, h('strong', {}, d.assetCode), ' ', h('span', { class: 'text-subtle text-xs' }, d.networkCode)) },
        { key: 'amount', label: t('common:fields.amount'), align: 'end', render: (d) => (d.amount ? h('bdi', { class: 'num', dir: 'ltr' }, formatAmount(d.amount, d.assetCode)) : h('span', { class: 'text-subtle' }, '—')) },
        { key: 'status', label: t('transactions:status'), render: (d) => (['detected', 'confirming'].includes(d.status) ? confirmationProgress(d.confirmations, d.requiredConfirmations) : statusBadge(d.status)) },
        { key: 'tx', label: t('transactions:txHash'), render: (d) => inlineHash(d.txHash, { href: d.explorerUrl }) },
        { key: 'date', label: t('transactions:date'), render: (d) => formatDateTime(d.createdAt) },
      ],
      onRowClick: (d) => openDepositDetail(d.id),
      empty: emptyState({ iconName: 'deposit', title: t('deposit:emptyTitle'), text: t('deposit:emptyText') }),
      caption: t('deposit:historyTitle'),
    });
    let filters = {};
    const more = loadMore({
      onLoad: async (cursor) => {
        const res = await depositsApi.list({ ...filters, cursor });
        table.update(res.items, { append: true });
        more.setCursor(res.nextCursor);
      },
    });
    async function loadList() {
      const res = await depositsApi.list(filters);
      table.update(res.items);
      more.setCursor(res.nextCursor);
    }
    const bar = filterBar({
      fields: [
        { name: 'status', type: 'select', label: t('transactions:status'), options: STATUSES.map((s) => ({ value: s, label: t(`common:status.${s}`) })) },
        { name: 'asset', type: 'select', label: t('common:fields.asset'), options: assets.map((a) => ({ value: a.code, label: a.code })) },
      ],
      onChange: (v) => {
        filters = v;
        loadList();
      },
    });
    filters = bar.values();

    const form = depositForm({ assets, holdDays, onRequested: () => loadList() });
    const how = statusTimeline(['send', 'detected', 'confirmations', 'credited', 'hold'].map((k) => ({ label: t(`deposit:how.${k}.title`), note: t(`deposit:how.${k}.text`, { count: holdDays }) })));

    replace(page,
      pageHeader({ title: t('deposit:title'), subtitle: t('deposit:subtitle'), actions: helpButton('deposit') }),
      h('div', { class: 'grid grid--sidebar' },
        h('section', { class: 'card', 'aria-labelledby': 'deposit-form-title' }, h('h2', { class: 'card__title', id: 'deposit-form-title' }, t('deposit:formTitle')), form.el),
        h('aside', { class: 'card card--sunken', 'aria-labelledby': 'deposit-how-title' }, h('h2', { class: 'card__title', id: 'deposit-how-title' }, t('deposit:howTitle')), how)),
      h('section', { class: 'stack', 'aria-labelledby': 'deposit-history-title' },
        h('h2', { class: 'section-title', id: 'deposit-history-title' }, t('deposit:historyTitle')),
        bar.el, table.el, more.el));

    await loadList();
    liveRefresh(['deposit.updated', 'balance.changed'], () => loadList().catch(() => {}));
  },
});
