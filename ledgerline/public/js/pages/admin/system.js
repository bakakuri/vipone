// System health: providers in use, database latency, ledger integrity,
// scheduled jobs, email outbox, chain-event anomalies, address pools.
import { adminApi } from '../../api/admin-endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { formatDateTime, formatRelative } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { jsonBlock, kpi, section } from '../../components/admin/admin-ui.js';
import { alertBox } from '../../components/feedback/alert.js';
import { statusBadge } from '../../components/feedback/status-badge.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { dataTable } from '../../components/tables/data-table.js';

definePage({
  id: 'admin-system',
  area: 'admin',
  auth: 'admin',
  permission: 'dashboard.read',
  namespaces: ['admin'],
  title: 'admin:system.title',
  async render({ page }) {
    const s = await adminApi.health();
    const providers = h('dl', { class: 'kv' }, Object.entries(s.providers).flatMap(([k, v]) => [h('dt', {}, t(`admin:system.providers.${k}`)), h('dd', {}, h('code', { dir: 'ltr' }, String(v)))]));
    const jobs = dataTable({
      columns: [
        { key: 'name', label: t('admin:system.job'), primary: true, render: (j) => h('code', { dir: 'ltr' }, j.jobName) },
        { key: 'status', label: t('admin:users.status'), render: (j) => statusBadge(j.status) },
        { key: 'when', label: t('admin:system.lastRun'), render: (j) => h('span', { title: formatDateTime(j.startedAt) }, formatRelative(j.startedAt)) },
        { key: 'result', label: t('admin:system.result'), render: (j) => (j.error ? h('span', { class: 'text-xs text-negative' }, j.error) : j.result ? h('details', {}, h('summary', {}, t('admin:show')), jsonBlock(j.result)) : '—') },
      ],
      rows: s.jobs,
      rowKey: (j) => j.jobName,
      empty: h('p', { class: 'text-small text-muted' }, t('admin:system.noJobs')),
    });
    const pools = dataTable({
      columns: [
        { key: 'n', label: t('common:fields.network'), primary: true, render: (p) => p.network },
        { key: 'a', label: t('admin:pool.available'), align: 'end', render: (p) => h('span', { class: p.available < 20 && p.isActive ? 'text-negative' : '' }, String(p.available)) },
        { key: 's', label: t('admin:users.status'), render: (p) => (p.isActive ? t('admin:settings.on') : t('admin:settings.off')) },
      ],
      rows: s.addressPools,
      rowKey: (p) => p.network,
    });
    replace(page,
      pageHeader({ title: t('admin:system.title'), subtitle: t('admin:system.subtitle', { mode: t(`admin:system.modes.${s.mode}`) }) }),
      s.ledgerIntegrityIssues ? alertBox({ tone: 'danger', title: t('admin:treasury.integrityIssues', { count: s.ledgerIntegrityIssues }), action: h('a', { class: 'btn btn--sm', href: '/admin/treasury' }, t('admin:nav.treasury')) }) : alertBox({ tone: 'success', text: t('admin:treasury.integrityOk') }),
      h('div', { class: 'grid grid--4' },
        kpi(t('admin:system.dbLatency'), `${s.database.latencyMs} ms`),
        kpi(t('admin:dashboard.approvals'), String(s.pendingApprovals), { href: '/admin/approvals' }),
        kpi(t('admin:dashboard.riskFlags'), String(s.openRiskFlags), { href: '/admin/users?tab=flags' }),
        kpi(t('admin:system.emailQueue'), t('admin:system.emailCounts', { queued: s.emailOutbox.queued || 0, failed: s.emailOutbox.failed || 0 }))),
      h('div', { class: 'grid grid--2' },
        section(t('admin:system.providersTitle'), providers),
        section(t('admin:system.chainEvents'), s.chainEventIssues.length
          ? h('dl', { class: 'kv' }, s.chainEventIssues.flatMap((e) => [h('dt', {}, e.processingResult || t('admin:system.unprocessed')), h('dd', {}, String(e.count))]))
          : h('p', { class: 'text-small text-muted' }, t('admin:system.noChainIssues')))),
      h('div', { class: 'grid grid--2' }, section(t('admin:system.jobs'), jobs.el), section(t('admin:pool.title'), pools.el)));
  },
});
