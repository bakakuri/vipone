// Overview: where the money is (ledger strip), open positions, realised
// earnings, deposits/withdrawals in progress, balance history and recent
// activity. Every figure comes from GET /api/v1/dashboard.
import { dashboardApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, icon, replace } from '../core/dom.js';
import { formatAmount, formatUsd } from '../formatting/format-currency.js';
import { formatDate, formatDay, formatRelative } from '../formatting/format-date.js';
import { t } from '../i18n/i18n.js';
import { getPref } from '../core/storage.js';
import { liveRefresh } from '../services/live-refresh.js';
import { balanceCard } from '../components/cards/balance-card.js';
import { liveEarnings } from '../components/cards/live-earnings.js';
import { lineChart } from '../components/charts/line-chart.js';
import { alertBox } from '../components/feedback/alert.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { skeletonBlock } from '../components/feedback/skeleton.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { confirmationProgress } from '../components/finance/confirmation-progress.js';
import { positionCard } from '../components/finance/position-card.js';
import { pageHeader } from '../components/misc/page-header.js';
import { helpButton } from '../components/onboarding/help-drawer.js';
import { startTour } from '../components/onboarding/onboarding-tour.js';
import { dataTable } from '../components/tables/data-table.js';
import { typeCell } from '../components/tables/transaction-history.js';
import { amount } from '../components/misc/amount-display.js';
import { openTransactionDetail } from '../components/modals/transaction-detail.js';

function accountAlerts(user) {
  const alerts = [];
  if (user.status !== 'active') alerts.push(alertBox({ tone: 'danger', title: t('dashboard:alerts.restrictedTitle'), text: t('dashboard:alerts.restrictedText'), action: h('a', { class: 'btn btn--sm', href: '/support' }, t('navigation:support')) }));
  if (!user.mfaEnabled) alerts.push(alertBox({ tone: 'info', title: t('dashboard:alerts.mfaTitle'), text: t('dashboard:alerts.mfaText'), action: h('a', { class: 'btn btn--sm', href: '/security' }, t('dashboard:alerts.mfaAction')) }));
  return alerts;
}

function card(title, link, ...children) {
  return h('section', { class: 'card' },
    h('div', { class: 'card__header' }, h('h2', { class: 'card__title' }, title), link ? h('a', { class: 'text-small', href: link }, t('common:actions.viewAll')) : null),
    ...children);
}

definePage({
  id: 'dashboard',
  area: 'app',
  namespaces: ['dashboard', 'transactions', 'investments', 'deposit', 'withdrawal'],
  title: 'dashboard:title',
  async render({ page, user }) {
    const balances = balanceCard({ onAssetChange: (a) => loadHistory(a) });
    const valuation = h('p', { class: 'text-xs text-subtle valuation' });
    const earnings = liveEarnings();
    const positionsBody = h('div', { class: 'stack' });
    const inFlightBody = h('div', { class: 'stack stack--sm' });
    const chartBody = h('div', { class: 'chart' }, skeletonBlock());
    const recentTable = dataTable({
      columns: [
        { key: 'type', label: t('transactions:type'), primary: true, render: typeCell },
        { key: 'amount', label: t('transactions:amount'), align: 'end', render: (r) => amount(r.amount, r.asset, { sign: true, tone: !r.informational }) },
        { key: 'postedAt', label: t('transactions:date'), render: (r) => h('time', { datetime: r.postedAt, title: formatDate(r.postedAt, { time: true }) }, formatRelative(r.postedAt)) },
      ],
      onRowClick: openTransactionDetail,
      empty: emptyState({ title: t('transactions:emptyTitle'), text: t('dashboard:firstDeposit'), action: h('a', { class: 'btn btn--sm btn--primary', href: '/deposit' }, t('navigation:deposit')) }),
    });

    replace(page,
      pageHeader({
        title: user.displayName ? t('dashboard:greeting', { name: user.displayName }) : t('dashboard:title'),
        subtitle: t('dashboard:subtitle'),
        actions: [
          helpButton('dashboard'),
          h('a', { class: 'btn', href: '/withdrawals' }, icon('withdraw', { size: 'sm' }), t('navigation:withdrawals')),
          h('a', { class: 'btn btn--primary', href: '/deposit' }, icon('deposit', { size: 'sm' }), t('navigation:deposit')),
        ],
      }),
      ...accountAlerts(user),
      h('div', { class: 'stack stack--sm' }, balances.el, valuation),
      h('div', { class: 'grid grid--sidebar dashboard-main' },
        h('div', { class: 'stack' },
          card(t('dashboard:positions'), '/investments', positionsBody),
          card(t('dashboard:history'), null, chartBody),
          card(t('dashboard:recent'), '/transactions', recentTable.el)),
        h('div', { class: 'stack' },
          earnings.el,
          card(t('dashboard:inFlight'), null, inFlightBody))));

    let historyAsset = null;
    async function loadHistory(asset) {
      historyAsset = asset;
      try {
        const hist = await dashboardApi.history(asset, 30);
        replace(chartBody, lineChart({
          points: hist.points.map((p) => ({ x: p.day, y: p.balance })),
          formatY: (v) => formatAmount(v, asset, { withAsset: false, compact: true }),
          formatX: formatDay,
          label: t('dashboard:historyLabel', { asset }),
        }), h('p', { class: 'text-xs text-subtle' }, t('dashboard:historyNote', { asset })));
      } catch {
        replace(chartBody, h('p', { class: 'text-small text-muted' }, t('common:chart.noData')));
      }
    }

    async function load() {
      const d = await dashboardApi.summary();
      balances.update(d.balances, d.holds);
      valuation.textContent = d.valuation.pricedAt
        ? t('dashboard:valuation', { value: formatUsd(d.valuation.total), time: formatRelative(d.valuation.pricedAt) })
        : t('dashboard:valuationUnavailable');

      replace(positionsBody, d.positions.length
        ? h('div', { class: 'position-grid' }, d.positions.slice(0, 4).map((p) => positionCard(p)))
        : emptyState({ iconName: 'layers', title: t('dashboard:noPositions'), text: t('dashboard:noPositionsText'), action: h('a', { class: 'btn btn--sm', href: '/investments' }, t('dashboard:browseProducts')) }));

      const inFlight = [
        ...d.openDeposits.map((dep) => h('a', { class: 'inflight-item', href: '/deposit' },
          h('span', { class: 'inflight-item__main' }, h('span', {}, t('dashboard:depositLine', { asset: dep.assetCode, network: dep.networkCode })),
            dep.amount ? h('span', { class: 'num text-small' }, formatAmount(dep.amount, dep.assetCode)) : null),
          ['detected', 'confirming'].includes(dep.status) ? confirmationProgress(dep.confirmations, dep.requiredConfirmations) : statusBadge(dep.status))),
        ...d.openWithdrawals.map((w) => h('a', { class: 'inflight-item', href: '/withdrawals' },
          h('span', { class: 'inflight-item__main' }, h('span', {}, t('dashboard:withdrawalLine', { reference: w.reference })), h('span', { class: 'num text-small' }, formatAmount(w.netAmount, w.assetCode))),
          statusBadge(w.status))),
      ];
      replace(inFlightBody, inFlight.length ? inFlight : h('p', { class: 'text-small text-muted' }, t('dashboard:nothingInFlight')));
      recentTable.update(d.recentTransactions);

      const asset = getPref('lastAsset') || d.balances.find((b) => b.total !== '0')?.asset || 'USDT';
      if (asset !== historyAsset) loadHistory(asset);
      return d;
    }

    await Promise.all([load(), earnings.load()]);
    liveRefresh(['balance.changed', 'deposit.updated', 'withdrawal.updated', 'position.updated'], () => load().then(() => loadHistory(historyAsset)).catch(() => {}));

    const ob = user.onboarding || {};
    if (!ob.completed && !ob.dismissed) setTimeout(() => startTour({ step: ob.step || 0 }), 600);
  },
});
