import { dashboardApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, icon, replace } from '../core/dom.js';
import { formatAmount, formatUsd } from '../formatting/format-currency.js';
import { formatDate, formatRelative } from '../formatting/format-date.js';
import { t } from '../i18n/i18n.js';
import { liveRefresh } from '../services/live-refresh.js';
import { balanceCard } from '../components/cards/balance-card.js';
import { alertBox } from '../components/feedback/alert.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { positionCard } from '../components/finance/position-card.js';
import { pageHeader } from '../components/misc/page-header.js';
import { dataTable } from '../components/tables/data-table.js';
import { typeCell } from '../components/tables/transaction-history.js';
import { amount } from '../components/misc/amount-display.js';
import { openTransactionDetail } from '../components/modals/transaction-detail.js';

function accountAlerts(user) {
  const alerts = [];
  if (user.status !== 'active') alerts.push(alertBox({ tone: 'danger', title: t('dashboard:alerts.restrictedTitle'), action: h('a', { class: 'btn btn--sm', href: '/support' }, t('navigation:support')) }));
  return alerts;
}

function card(title, link, ...children) {
  return h('section', { class: 'card card--compact' },
    h('div', { class: 'card__header' }, h('h2', { class: 'card__title' }, title), link ? h('a', { class: 'text-small', href: link }, t('common:actions.viewAll')) : null),
    ...children);
}

// Compact overview: balance, the two money actions, what is in progress,
// recent activity and open positions. Every figure comes from GET /dashboard.
definePage({
  id: 'dashboard',
  area: 'app',
  namespaces: ['dashboard', 'transactions', 'investments', 'deposit', 'withdrawal'],
  title: 'dashboard:title',
  async render({ page, user }) {
    const balances = balanceCard();
    const valuation = h('p', { class: 'text-xs text-subtle valuation' });
    const positionsSlot = h('div');
    const inFlightBody = h('div', { class: 'stack stack--sm' });
    const recentTable = dataTable({
      columns: [
        { key: 'type', label: t('transactions:type'), primary: true, render: typeCell },
        { key: 'amount', label: t('transactions:amount'), align: 'end', render: (r) => amount(r.amount, r.asset, { sign: true, tone: !r.informational }) },
        { key: 'postedAt', label: t('transactions:date'), render: (r) => h('time', { datetime: r.postedAt, title: formatDate(r.postedAt, { time: true }) }, formatRelative(r.postedAt)) },
      ],
      onRowClick: openTransactionDetail,
      empty: emptyState({ title: t('transactions:emptyTitle'), action: h('a', { class: 'btn btn--sm btn--primary', href: '/deposit' }, t('navigation:deposit')) }),
    });
    const actions = h('div', { class: 'quick-actions' },
      h('a', { class: 'btn btn--primary btn--lg', href: '/deposit' }, icon('deposit', { size: 'sm' }), t('navigation:deposit')),
      h('a', { class: 'btn btn--lg', href: '/withdrawals' }, icon('withdraw', { size: 'sm' }), t('navigation:withdrawals')));

    replace(page,
      pageHeader({ title: user.displayName ? t('dashboard:greeting', { name: user.displayName }) : t('dashboard:title') }),
      ...accountAlerts(user),
      h('div', { class: 'stack stack--sm' }, balances.el, actions, valuation),
      inFlightBody,
      h('div', { class: 'grid grid--sidebar dashboard-main' },
        card(t('dashboard:recent'), '/transactions', recentTable.el),
        positionsSlot));

    async function load() {
      const d = await dashboardApi.summary();
      balances.update(d.balances, d.holds);
      valuation.textContent = d.valuation.pricedAt ? t('dashboard:valuationShort', { value: formatUsd(d.valuation.total) }) : '';

      replace(positionsSlot, d.positions.length
        ? card(t('dashboard:positions'), '/investments', h('div', { class: 'stack stack--sm' }, d.positions.slice(0, 3).map((p) => positionCard(p))))
        : card(t('dashboard:positions'), null, h('div', { class: 'stack stack--sm' },
            h('p', { class: 'text-small text-muted' }, t('dashboard:noPositions')),
            h('a', { class: 'btn btn--sm', href: '/investments' }, t('dashboard:browseProducts')))));

      const inFlight = [
        ...d.openDeposits.map((dep) => h('a', { class: 'inflight-item', href: '/deposit' },
          h('span', { class: 'inflight-item__main' }, h('span', {}, t('navigation:deposit')),
            dep.amount ? h('span', { class: 'num text-small' }, formatAmount(dep.amount, dep.assetCode)) : null),
          statusBadge(dep.status))),
        ...d.openWithdrawals.map((w) => h('a', { class: 'inflight-item', href: '/withdrawals' },
          h('span', { class: 'inflight-item__main' }, h('span', {}, t('navigation:withdrawals')), h('span', { class: 'num text-small' }, formatAmount(w.netAmount, w.assetCode))),
          statusBadge(w.status))),
      ];
      replace(inFlightBody, inFlight.length ? h('section', { class: 'card card--compact inflight' }, h('h2', { class: 'card__title' }, t('dashboard:inFlight')), inFlight) : null);
      recentTable.update(d.recentTransactions.slice(0, 6));
      return d;
    }

    await load();
    liveRefresh(['balance.changed', 'deposit.updated', 'withdrawal.updated', 'position.updated'], () => load().catch(() => {}));
  },
});
