// Deposit page: personal address per network, rules before sending, and the
// list of deposits with live confirmation progress.
import { depositsApi, publicApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { formatAmount, registerAssets } from '../formatting/format-currency.js';
import { formatDateTime } from '../formatting/format-date.js';
import { localized, t } from '../i18n/i18n.js';
import { liveRefresh } from '../services/live-refresh.js';
import { alertBox } from '../components/feedback/alert.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { confirmationProgress } from '../components/finance/confirmation-progress.js';
import { statusTimeline } from '../components/finance/status-timeline.js';
import { depositForm } from '../components/forms/deposit-form.js';
import { instructionText, manualDepositForm } from '../components/finance/manual-deposit.js';
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
    // Methods published by staff (Admin → Deposits → Deposit methods) replace
    // the automatic personal-address flow when at least one is active.
    const [assets, published] = await Promise.all([
      publicApi.assets(),
      depositsApi.methods().catch(() => ({ methods: [], notice: {} })),
    ]);
    registerAssets(assets);
    const manual = published.methods.length > 0;
    const noticeText = localized(published.notice);
    const holdDays = config.depositHoldDays ?? 7;

    const table = dataTable({
      columns: [
        { key: 'asset', label: t('common:fields.asset'), primary: true, render: (d) => h('span', {}, h('strong', {}, d.assetCode), ' ', h('span', { class: 'text-subtle text-xs' }, d.networkCode)) },
        { key: 'amount', label: t('common:fields.amount'), align: 'end', render: (d) => (d.amount ? h('bdi', { class: 'num', dir: 'ltr' }, formatAmount(d.amount, d.assetCode)) : h('span', { class: 'text-subtle' }, '—')) },
        { key: 'status', label: t('transactions:status'), render: (d) => (['detected', 'confirming'].includes(d.status) ? confirmationProgress(d.confirmations, d.requiredConfirmations) : d.source === 'manual' && d.status === 'under_review' ? h('span', { class: 'badge badge--pending' }, t('deposit:manual.checking')) : statusBadge(d.status)) },
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

    const form = manual
      ? manualDepositForm({ methods: published.methods, assets, holdDays, onReported: () => loadList() })
      : depositForm({ assets, holdDays, onRequested: () => loadList() });
    const steps = manual ? ['send', 'report', 'check', 'credited', 'hold'] : ['send', 'detected', 'confirmations', 'credited', 'hold'];
    const how = statusTimeline(steps.filter((k) => k !== 'hold' || holdDays > 0).map((k) => ({
      label: t(manual ? `deposit:manualHow.${k}.title` : `deposit:how.${k}.title`),
      note: t(manual ? `deposit:manualHow.${k}.text` : `deposit:how.${k}.text`, { count: holdDays }),
    })));
    const notice = noticeText ? alertBox({ tone: 'info', children: instructionText(noticeText) }) : null;

    replace(page,
      pageHeader({ title: t('deposit:title'), subtitle: t(manual ? 'deposit:manual.subtitle' : 'deposit:subtitle'), actions: helpButton('deposit') }),
      notice,
      h('div', { class: 'grid grid--sidebar' },
        h('section', { class: 'card', 'aria-labelledby': 'deposit-form-title' }, h('h2', { class: 'card__title', id: 'deposit-form-title' }, t(manual ? 'deposit:manual.formTitle' : 'deposit:formTitle')), form.el),
        h('aside', { class: 'card card--sunken', 'aria-labelledby': 'deposit-how-title' }, h('h2', { class: 'card__title', id: 'deposit-how-title' }, t('deposit:howTitle')), how)),
      h('section', { class: 'stack', 'aria-labelledby': 'deposit-history-title' },
        h('h2', { class: 'section-title', id: 'deposit-history-title' }, t('deposit:historyTitle')),
        bar.el, table.el, more.el));

    await loadList();
    liveRefresh(['deposit.updated', 'balance.changed'], () => loadList().catch(() => {}));
  },
});
