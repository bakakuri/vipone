// Withdrawals: address + amount -> quote -> confirm; the request then waits
// for staff, who pay it out. History with live status; pending requests can
// be cancelled and the reserved amount returns to the balance.
import { dashboardApi, publicApi, withdrawalsApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { formatAmount, registerAssets } from '../formatting/format-currency.js';
import { formatRelative } from '../formatting/format-date.js';
import { t } from '../i18n/i18n.js';
import { liveRefresh } from '../services/live-refresh.js';
import { alertBox } from '../components/feedback/alert.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { errorMessage } from '../components/feedback/error-message.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { simpleWithdrawalForm } from '../components/forms/simple-withdrawal-form.js';
import { pageHeader } from '../components/misc/page-header.js';
import { confirmDialog } from '../components/modals/confirm-dialog.js';
import { openWithdrawalDetail } from '../components/modals/withdrawal-detail.js';
import { toast } from '../components/notifications/toast.js';
import { dataTable } from '../components/tables/data-table.js';
import { loadMore } from '../components/tables/load-more.js';

definePage({
  id: 'withdrawals',
  area: 'app',
  namespaces: ['withdrawal', 'transactions'],
  title: 'withdrawal:title',
  async render({ page, user, config }) {
    const [assets, summary] = await Promise.all([publicApi.assets(), dashboardApi.summary()]);
    registerAssets(assets);
    const routes = assets.flatMap((a) => a.networks.filter((n) => n.withdrawalEnabled).map((n) => ({
      asset: a.code, network: n.code, networkName: n.name, minWithdrawal: n.minWithdrawal, networkFee: n.withdrawalNetworkFee,
    })));

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
        { key: 'amount', label: t('withdrawal:youReceive'), primary: true, render: (w) => h('bdi', { class: 'num', dir: 'ltr' }, formatAmount(w.netAmount, w.assetCode)) },
        { key: 'status', label: t('transactions:status'), render: (w) => statusBadge(w.status) },
        { key: 'date', label: t('transactions:date'), render: (w) => h('time', { datetime: w.createdAt }, formatRelative(w.createdAt)) },
        { key: 'actions', label: '', actions: true, render: (w) => (w.status === 'pending' ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: (e) => { e.stopPropagation(); cancel(w); } } }, t('withdrawal:cancel')) : null) },
      ],
      onRowClick: (w) => openWithdrawalDetail(w.id),
      empty: emptyState({ iconName: 'withdraw', title: t('withdrawal:emptyTitle') }),
      caption: t('withdrawal:historyTitle'),
    });
    const more = loadMore({
      onLoad: async (cursor) => {
        const res = await withdrawalsApi.list({ cursor });
        table.update(res.items, { append: true });
        more.setCursor(res.nextCursor);
      },
    });
    async function loadList() {
      const res = await withdrawalsApi.list({});
      table.update(res.items);
      more.setCursor(res.nextCursor);
    }

    const form = routes.length
      ? simpleWithdrawalForm({ routes, balances: summary.balances, needsMfa: config.withdrawalMfa !== false && !user.mfaEnabled, onCreated: () => loadList() })
      : { el: alertBox({ tone: 'warning', title: t('withdrawal:simple.unavailable') }) };

    replace(page,
      pageHeader({ title: t('withdrawal:title') }),
      h('div', { class: 'money-layout' },
        h('section', { class: 'card card--compact', 'aria-label': t('withdrawal:formTitle') }, form.el),
        h('section', { class: 'card card--compact card--flush', 'aria-labelledby': 'wd-history-title' },
          h('div', { class: 'card__header' }, h('h2', { class: 'card__title', id: 'wd-history-title' }, t('withdrawal:historyTitle'))),
          table.el, more.el)));

    await loadList();
    liveRefresh(['withdrawal.updated'], () => loadList().catch(() => {}));
    liveRefresh(['balance.changed'], async () => {
      const next = await dashboardApi.summary().catch(() => null);
      if (next) form.update?.({ balances: next.balances });
    });
  },
});
