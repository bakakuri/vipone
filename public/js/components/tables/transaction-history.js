// Transaction history built from the ledger: filters (mirrored in the URL),
// keyset "show more", CSV export, detail with ledger entries, and live
// refresh when the server reports a balance change.
import { transactionsApi } from '../../api/endpoints.js';
import { h, icon } from '../../core/dom.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { onLive } from '../../services/live-connection.js';
import { downloadResponse } from '../../utils/download.js';
import { emptyState } from '../feedback/empty-state.js';
import { errorState } from '../feedback/error-state.js';
import { statusBadge } from '../feedback/status-badge.js';
import { setBusy } from '../forms/form-validation.js';
import { amount } from '../misc/amount-display.js';
import { openTransactionDetail } from '../modals/transaction-detail.js';
import { toastError } from '../notifications/toast.js';
import { dataTable } from './data-table.js';
import { filterBar } from './filter-bar.js';
import { loadMore } from './load-more.js';

export const TRANSACTION_TYPES = ['deposit', 'withdrawal', 'investment_allocation', 'investment_release', 'profit', 'loss', 'referral_reward', 'fee', 'refund', 'adjustment'];
const TYPE_ICON = {
  deposit: 'deposit', withdrawal: 'withdraw', investment_allocation: 'layers', investment_release: 'layers', profit: 'earnings', loss: 'earnings',
  referral_reward: 'referrals', fee: 'coins', refund: 'refresh', adjustment: 'scale',
};

export function typeCell(row) {
  return h('span', { class: 'tx-type' }, h('span', { class: `tx-type__icon tx-type__icon--${row.type}` }, icon(TYPE_ICON[row.type] || 'ledger', { size: 'sm' })),
    h('span', {}, t(`transactions:types.${row.type}`), row.informational ? h('span', { class: 'text-xs text-subtle tx-type__note' }, t('transactions:included')) : null));
}

export function transactionHistory({ assets = [], withFilters = true, pageSize = 25, compact = false } = {}) {
  const columns = [
    { key: 'type', label: t('transactions:type'), primary: true, render: typeCell },
    { key: 'amount', label: t('transactions:amount'), align: 'end', render: (r) => amount(r.amount, r.asset, { sign: true, tone: !r.informational }) },
    { key: 'status', label: t('transactions:status'), render: (r) => statusBadge(r.status) },
    compact ? null : { key: 'reference', label: t('transactions:reference'), render: (r) => (r.reference ? h('bdi', { class: 'mono text-xs', dir: 'ltr' }, r.reference) : '—') },
    { key: 'postedAt', label: t('transactions:date'), render: (r) => h('time', { datetime: r.postedAt }, formatDateTime(r.postedAt)) },
  ].filter(Boolean);

  const empty = emptyState({ iconName: 'ledger', title: t('transactions:emptyTitle'), text: t('transactions:emptyText'), action: h('a', { class: 'btn btn--sm btn--primary', href: '/deposit' }, t('transactions:emptyAction')) });
  const table = dataTable({ columns, onRowClick: openTransactionDetail, empty, caption: t('transactions:title') });
  const status = h('div');
  let rows = [];
  let filters = {};

  const more = loadMore({
    onLoad: async (cursor) => {
      const page = await transactionsApi.list({ ...filters, limit: pageSize, cursor });
      rows = rows.concat(page.items);
      table.update(page.items, { append: true });
      more.setCursor(page.nextCursor);
    },
  });

  async function load() {
    status.replaceChildren();
    try {
      const page = await transactionsApi.list({ ...filters, limit: pageSize });
      rows = page.items;
      table.update(rows);
      more.setCursor(withFilters ? page.nextCursor : null);
    } catch (err) {
      status.replaceChildren(errorState(err, { onRetry: load }));
    }
  }

  let bar = null;
  let exportBtn = null;
  if (withFilters) {
    bar = filterBar({
      fields: [
        { name: 'type', type: 'select', label: t('transactions:type'), options: TRANSACTION_TYPES.map((v) => ({ value: v, label: t(`transactions:types.${v}`) })) },
        { name: 'asset', type: 'select', label: t('common:fields.asset'), options: assets.map((a) => ({ value: a.code, label: a.code })) },
        { name: 'from', type: 'date', label: t('common:filters.from') },
        { name: 'to', type: 'date', label: t('common:filters.to') },
      ],
      onChange: (v) => {
        filters = v;
        load();
      },
    });
    filters = bar.values();
    exportBtn = h('button', { class: 'btn btn--sm', type: 'button' }, icon('download', { size: 'sm' }), t('transactions:export'));
    exportBtn.addEventListener('click', async () => {
      setBusy(exportBtn, true);
      try {
        await downloadResponse(await transactionsApi.exportCsv(filters), 'transactions.csv');
      } catch (err) {
        toastError(err);
      } finally {
        setBusy(exportBtn, false);
      }
    });
  }

  onLive(['balance.changed', 'withdrawal.updated'], () => {
    if (!document.hidden) load();
  });

  const el = h('div', { class: 'stack' }, bar?.el, status, table.el, more.el);
  return { el, load, exportButton: exportBtn };
}
