// Deposit: the published method (QR, address, copy), "I have sent it" and the
// list of the user's deposits. Deposits are credited by staff after they have
// checked the payment on the blockchain — nothing is credited automatically.
import { depositsApi, publicApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { formatAmount, registerAssets } from '../formatting/format-currency.js';
import { formatRelative } from '../formatting/format-date.js';
import { localized, t } from '../i18n/i18n.js';
import { liveRefresh } from '../services/live-refresh.js';
import { alertBox } from '../components/feedback/alert.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { instructionText, manualDepositForm } from '../components/finance/manual-deposit.js';
import { pageHeader } from '../components/misc/page-header.js';
import { openDepositDetail } from '../components/modals/deposit-detail.js';
import { dataTable } from '../components/tables/data-table.js';
import { loadMore } from '../components/tables/load-more.js';

definePage({
  id: 'deposit',
  area: 'app',
  namespaces: ['deposit', 'transactions'],
  title: 'deposit:title',
  async render({ page, user }) {
    const [assets, published] = await Promise.all([
      publicApi.assets(),
      depositsApi.methods().catch(() => ({ methods: [], notice: {} })),
    ]);
    registerAssets(assets);
    const noticeText = localized(published.notice);

    const table = dataTable({
      columns: [
        { key: 'amount', label: t('common:fields.amount'), primary: true, render: (d) => (d.amount ? h('bdi', { class: 'num', dir: 'ltr' }, formatAmount(d.amount, d.assetCode)) : '—') },
        { key: 'status', label: t('transactions:status'), render: (d) => (d.source === 'manual' && d.status === 'under_review' ? h('span', { class: 'badge badge--pending' }, t('deposit:manual.checking')) : statusBadge(d.status)) },
        { key: 'date', label: t('transactions:date'), align: 'end', render: (d) => h('time', { datetime: d.createdAt }, formatRelative(d.createdAt)) },
      ],
      onRowClick: (d) => openDepositDetail(d.id),
      empty: emptyState({ iconName: 'deposit', title: t('deposit:emptyTitle') }),
      caption: t('deposit:historyTitle'),
    });
    const more = loadMore({
      onLoad: async (cursor) => {
        const res = await depositsApi.list({ cursor });
        table.update(res.items, { append: true });
        more.setCursor(res.nextCursor);
      },
    });
    async function loadList() {
      const res = await depositsApi.list({});
      table.update(res.items);
      more.setCursor(res.nextCursor);
    }

    const body = published.methods.length
      ? manualDepositForm({ methods: published.methods, assets, user, onReported: () => loadList() }).el
      : alertBox({ tone: 'warning', title: t('deposit:unavailableTitle'), text: t('deposit:unavailableText') });

    replace(page,
      pageHeader({ title: t('deposit:title') }),
      noticeText ? alertBox({ tone: 'info', children: instructionText(noticeText) }) : null,
      h('div', { class: 'money-layout' },
        h('section', { class: 'card card--compact', 'aria-label': t('deposit:title') }, body),
        h('section', { class: 'card card--compact card--flush', 'aria-labelledby': 'deposit-history-title' },
          h('div', { class: 'card__header' }, h('h2', { class: 'card__title', id: 'deposit-history-title' }, t('deposit:historyTitle'))),
          table.el, more.el)));

    await loadList();
    liveRefresh(['deposit.updated', 'balance.changed'], () => loadList().catch(() => {}));
  },
});
