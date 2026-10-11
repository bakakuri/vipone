// Withdrawals: request (quote -> confirm), fee rules, and history with live
// status. Pending requests can be cancelled; the held amount is returned.
import { dashboardApi, walletsApi, withdrawalsApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { formatAmount } from '../formatting/format-currency.js';
import { formatDateTime } from '../formatting/format-date.js';
import { t } from '../i18n/i18n.js';
import { liveRefresh } from '../services/live-refresh.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { errorMessage } from '../components/feedback/error-message.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { withdrawalForm } from '../components/forms/withdrawal-form.js';
import { inlineHash } from '../components/misc/address-display.js';
import { pageHeader } from '../components/misc/page-header.js';
import { confirmDialog } from '../components/modals/confirm-dialog.js';
import { openWithdrawalDetail } from '../components/modals/withdrawal-detail.js';
import { toast } from '../components/notifications/toast.js';
import { helpButton } from '../components/onboarding/help-drawer.js';
import { dataTable } from '../components/tables/data-table.js';
import { filterBar } from '../components/tables/filter-bar.js';
import { loadMore } from '../components/tables/load-more.js';

const STATUSES = ['pending', 'under_review', 'approved', 'processing', 'completed', 'rejected', 'failed', 'cancelled'];

definePage({
  id: 'withdrawals',
  area: 'app',
  namespaces: ['withdrawal', 'transactions', 'wallets'],
  title: 'withdrawal:title',
  async render({ page, user, config }) {
    const [wallets, summary] = await Promise.all([walletsApi.list(), dashboardApi.summary()]);
    let filters = {};

    async function cancel(w) {
      const ok = await confirmDialog({ title: t('withdrawal:cancelTitle'), text: t('withdrawal:cancelText', { reference: w.reference }), confirmLabel: t('withdrawal:cancel'), tone: 'danger' });
      if (!ok) return;
      try {
        await withdrawalsApi.cancel(w.id);
        toast(t('withdrawal:cancelled'));
        loadList();
      } catch (err) {
        toast(errorMessage(err), { tone: 'error' });
      }
    }

    const table = dataTable({
      columns: [
        { key: 'reference', label: t('withdrawal:reference'), primary: true, render: (w) => h('bdi', { class: 'mono', dir: 'ltr' }, w.reference) },
        { key: 'amount', label: t('withdrawal:youReceive'), align: 'end', render: (w) => h('bdi', { class: 'num', dir: 'ltr', title: t('withdrawal:requestedAmount', { amount: formatAmount(w.amount, w.assetCode) }) }, formatAmount(w.netAmount, w.assetCode)) },
        { key: 'status', label: t('transactions:status'), render: (w) => statusBadge(w.status) },
        { key: 'to', label: t('withdrawal:destination'), render: (w) => h('span', {}, w.walletLabel, ' ', h('span', { class: 'text-xs text-subtle' }, w.networkCode)) },
        { key: 'tx', label: t('transactions:txHash'), render: (w) => inlineHash(w.txHash, { href: w.explorerUrl }) },
        { key: 'date', label: t('transactions:date'), render: (w) => formatDateTime(w.createdAt) },
        { key: 'actions', label: '', actions: true, render: (w) => (w.status === 'pending' ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: () => cancel(w) } }, t('withdrawal:cancel')) : null) },
      ],
      onRowClick: (w) => openWithdrawalDetail(w.id),
      empty: emptyState({ iconName: 'withdraw', title: t('withdrawal:emptyTitle'), text: t('withdrawal:emptyText') }),
      caption: t('withdrawal:historyTitle'),
    });
    const more = loadMore({
      onLoad: async (cursor) => {
        const res = await withdrawalsApi.list({ ...filters, cursor });
        table.update(res.items, { append: true });
        more.setCursor(res.nextCursor);
      },
    });
    async function loadList() {
      const res = await withdrawalsApi.list(filters);
      table.update(res.items);
      more.setCursor(res.nextCursor);
    }
    const bar = filterBar({
      fields: [{ name: 'status', type: 'select', label: t('transactions:status'), options: STATUSES.map((s) => ({ value: s, label: t(`common:status.${s}`) })) }],
      onChange: (v) => {
        filters = v;
        loadList();
      },
    });
    filters = bar.values();

    const form = withdrawalForm({ wallets, balances: summary.balances, mfaEnabled: user.mfaEnabled, onCreated: () => loadList() });
    const rules = h('ul', { class: 'rule-list' },
      ['fee', 'network', 'hold', 'cooldown', 'review', 'cancel'].map((k) => h('li', {}, h('strong', {}, t(`withdrawal:rules.${k}.title`)), h('span', {}, t(`withdrawal:rules.${k}.text`, { count: config.depositHoldDays ?? 7 })))));

    replace(page,
      pageHeader({ title: t('withdrawal:title'), subtitle: t('withdrawal:subtitle'), actions: [helpButton('withdrawals'), h('a', { class: 'btn', href: '/wallets' }, t('navigation:wallets'))] }),
      h('div', { class: 'grid grid--sidebar' },
        h('section', { class: 'card', 'aria-labelledby': 'wd-form-title' }, h('h2', { class: 'card__title', id: 'wd-form-title' }, t('withdrawal:formTitle')), form.el),
        h('aside', { class: 'card card--sunken', 'aria-labelledby': 'wd-rules-title' }, h('h2', { class: 'card__title', id: 'wd-rules-title' }, t('withdrawal:rulesTitle')), rules)),
      h('section', { class: 'stack', 'aria-labelledby': 'wd-history-title' },
        h('h2', { class: 'section-title', id: 'wd-history-title' }, t('withdrawal:historyTitle')),
        bar.el, table.el, more.el));

    await loadList();
    liveRefresh(['withdrawal.updated'], () => loadList().catch(() => {}));
    liveRefresh(['balance.changed'], async () => {
      const next = await dashboardApi.summary().catch(() => null);
      if (next) form.update({ balances: next.balances });
    });
  },
});
