// Admin overview: queues that need people (approvals, reviews, KYC, risk
// flags), solvency per asset, and 14 days of activity. Counted from records.
import { adminApi } from '../../api/admin-endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDay } from '../../formatting/format-date.js';
import { formatInteger } from '../../formatting/format-number.js';
import { t } from '../../i18n/i18n.js';
import { liveRefresh } from '../../services/live-refresh.js';
import { coverageBadge, kpi, section } from '../../components/admin/admin-ui.js';
import { barChart } from '../../components/charts/bar-chart.js';
import { statusBadge } from '../../components/feedback/status-badge.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { dataTable } from '../../components/tables/data-table.js';

definePage({
  id: 'admin-dashboard',
  area: 'admin',
  auth: 'admin',
  permission: 'dashboard.read',
  namespaces: ['admin'],
  title: 'admin:dashboard.title',
  async render({ page }) {
    const kpis = h('div', { class: 'grid grid--4' });
    const solvency = dataTable({
      columns: [
        { key: 'asset', label: t('common:fields.asset'), primary: true, render: (a) => h('strong', {}, a.asset) },
        { key: 'custody', label: t('admin:treasury.custody'), align: 'end', render: (a) => formatAmount(a.custody, a.asset, { withAsset: false }) },
        { key: 'strategy', label: t('admin:treasury.strategy'), align: 'end', render: (a) => formatAmount(a.strategy, a.asset, { withAsset: false }) },
        { key: 'liabilities', label: t('admin:treasury.liabilities'), align: 'end', render: (a) => formatAmount(a.userLiabilities, a.asset, { withAsset: false }) },
        { key: 'equity', label: t('admin:treasury.equity'), align: 'end', render: (a) => formatAmount(a.platformEquity, a.asset, { withAsset: false }) },
        { key: 'coverage', label: t('admin:treasury.coverage'), render: (a) => coverageBadge(a.coverageRatio) },
      ],
      rowKey: (a) => a.asset,
      caption: t('admin:dashboard.solvency'),
    });
    const queue = h('div', { class: 'stack stack--sm' });
    const chartSlot = h('div');

    async function load() {
      const d = await adminApi.dashboard();
      const open = (s) => d.withdrawals.filter((w) => w.status === s).reduce((n, w) => n + w.count, 0);
      replace(kpis,
        kpi(t('admin:dashboard.approvals'), formatInteger(d.pendingApprovals), { href: '/admin/approvals', tone: d.pendingApprovals ? 'warning' : '' }),
        kpi(t('admin:dashboard.withdrawalsWaiting'), formatInteger(open('pending') + open('under_review') + open('approved')), { href: '/admin/withdrawals' }),
        kpi(t('admin:dashboard.riskFlags'), formatInteger(d.openRiskFlags), { href: '/admin/users?tab=flags', tone: d.openRiskFlags ? 'warning' : '' }),
        kpi(t('admin:dashboard.kycPending'), formatInteger(d.users.kycPending), { href: '/admin/users?kyc=pending' }),
        kpi(t('admin:dashboard.users'), formatInteger(d.users.total), { hint: t('admin:dashboard.newUsers', { day: formatInteger(d.users.new24h), week: formatInteger(d.users.new7d) }) }),
        kpi(t('admin:dashboard.restricted'), formatInteger(d.users.restricted)),
        kpi(t('admin:dashboard.ledgerTx'), formatInteger(d.ledgerTransactions24h), { hint: t('admin:dashboard.last24h') }),
        kpi(t('admin:dashboard.credited24h'), d.depositsCredited24h.length ? d.depositsCredited24h.map((x) => formatAmount(x.amount, x.assetCode)).join(' · ') : '0'));
      solvency.update(d.assets);
      replace(queue, d.withdrawals.length
        ? d.withdrawals.map((w) => h('div', { class: 'cluster cluster--between' }, statusBadge(w.status), h('span', { class: 'num' }, formatInteger(w.count))))
        : h('p', { class: 'text-small text-muted' }, t('admin:dashboard.queueEmpty')));
      replace(chartSlot, barChart({
        categories: d.daily.map((x) => x.day),
        series: [
          { name: t('admin:dashboard.series.deposits'), values: d.daily.map((x) => x.deposits), className: 'chart__bar--a', swatch: 'var(--color-seg-available)' },
          { name: t('admin:dashboard.series.withdrawals'), values: d.daily.map((x) => x.withdrawals), className: 'chart__bar--b', swatch: 'var(--color-seg-withdrawal-hold)' },
          { name: t('admin:dashboard.series.registrations'), values: d.daily.map((x) => x.registrations), className: 'chart__bar--c', swatch: 'var(--color-seg-invested)' },
        ],
        formatX: formatDay,
        label: t('admin:dashboard.activity'),
      }));
    }

    replace(page,
      pageHeader({ title: t('admin:dashboard.title'), subtitle: t('admin:dashboard.subtitle') }),
      kpis,
      section(t('admin:dashboard.solvency'), h('p', { class: 'text-xs text-subtle' }, t('admin:dashboard.solvencyHint')), solvency.el),
      h('div', { class: 'grid grid--sidebar' },
        section(t('admin:dashboard.activity'), chartSlot),
        section(t('admin:dashboard.withdrawalQueue'), queue)));
    await load();
    liveRefresh(['deposit.updated', 'withdrawal.updated', 'approval.created', 'reconciliation.mismatch', 'support.ticket_created'], () => load().catch(() => {}), { wait: 1500 });
  },
});
