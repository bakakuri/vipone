// Four-eyes approvals: setting relaxations, fee rules, balance adjustments,
// role changes and account reinstatements wait here for a second person.
// The requester cannot approve their own request (enforced by the server).
import { adminApi } from '../../api/admin-endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { can, currentUser } from '../../auth/session.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { liveRefresh } from '../../services/live-refresh.js';
import { actionButton } from '../../components/admin/action-button.js';
import { jsonBlock } from '../../components/admin/admin-ui.js';
import { emptyState } from '../../components/feedback/empty-state.js';
import { statusBadge } from '../../components/feedback/status-badge.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { segmented } from '../../components/misc/tabs.js';
import { dataTable } from '../../components/tables/data-table.js';
import { loadMore } from '../../components/tables/load-more.js';

function summary(a) {
  const p = a.payload || {};
  switch (a.actionType) {
    case 'settings.update': return t('admin:approvals.summary.setting', { key: p.key, value: JSON.stringify(p.value) });
    case 'ledger.adjustment': return t('admin:approvals.summary.adjustment', { direction: t(`admin:user.adjust.${p.direction === 'credit_user' ? 'credit' : 'debit'}`), amount: p.amount, asset: p.asset });
    case 'role.grant': case 'role.revoke': return t(`admin:approvals.summary.${a.actionType === 'role.grant' ? 'grant' : 'revoke'}`, { role: t(`admin:roles.${p.role}`) });
    case 'fee_rule.create': return t('admin:approvals.summary.feeRule', { rate: p.rate, asset: p.asset || '*', network: p.network || '*' });
    case 'user.reinstate': return t('admin:approvals.summary.reinstate');
    default: return a.actionType;
  }
}

definePage({
  id: 'admin-approvals',
  area: 'admin',
  auth: 'admin',
  permission: 'approvals.read',
  namespaces: ['admin'],
  title: 'admin:approvals.title',
  async render({ page }) {
    const me = currentUser();
    let status = 'pending';
    const table = dataTable({
      columns: [
        { key: 'type', label: t('admin:approvals.type'), primary: true, render: (a) => h('span', { class: 'stack stack--sm' }, h('strong', {}, t(`admin:approvals.types.${a.actionType}`)), h('span', { class: 'text-small' }, summary(a))) },
        { key: 'target', label: t('admin:approvals.target'), render: (a) => (a.payload?.userId ? h('a', { href: `/admin/user?id=${a.payload.userId}` }, t('admin:approvals.openUser')) : '—') },
        { key: 'reason', label: t('common:fields.reason'), render: (a) => h('span', { class: 'text-small' }, a.reason) },
        { key: 'by', label: t('admin:approvals.requestedBy'), render: (a) => h('span', { class: 'text-xs' }, a.requestedByEmail, h('br'), formatDateTime(a.createdAt)) },
        { key: 'status', label: t('admin:users.status'), render: (a) => h('span', { class: 'stack stack--sm' }, statusBadge(a.status), a.decidedByEmail ? h('span', { class: 'text-xs text-subtle' }, a.decidedByEmail) : null, a.status === 'failed' && a.result?.error ? h('span', { class: 'text-xs text-negative' }, String(a.result.error)) : null, a.decisionNote ? h('span', { class: 'text-xs text-subtle' }, a.decisionNote) : null) },
        { key: 'details', label: t('admin:flags.details'), render: (a) => h('details', {}, h('summary', {}, t('admin:show')), jsonBlock(a.payload)) },
        { key: 'actions', label: '', actions: true, render: (a) => {
          if (a.status !== 'pending' || !can('approvals.decide')) return null;
          if (a.requestedBy === me.id) return h('span', { class: 'text-xs text-subtle' }, t('admin:approvals.own'));
          return h('div', { class: 'cluster' },
            actionButton(t('admin:approvals.approve'), { tone: 'primary', confirm: t('admin:approvals.approveText'), run: () => adminApi.approve(a.id), onDone: load }),
            actionButton(t('admin:approvals.reject'), { tone: 'danger', reason: true, run: (note) => adminApi.reject(a.id, note), onDone: load }));
        } },
      ],
      empty: emptyState({ iconName: 'check-list', title: t('admin:approvals.none') }),
    });
    const more = loadMore({ onLoad: async (cursor) => { const r = await adminApi.approvals({ status, cursor }); table.update(r.items, { append: true }); more.setCursor(r.nextCursor); } });
    async function load() {
      const r = await adminApi.approvals({ status });
      table.update(r.items);
      more.setCursor(r.nextCursor);
    }
    replace(page,
      pageHeader({ title: t('admin:approvals.title'), subtitle: t('admin:approvals.subtitle') }),
      segmented(['pending', 'executed', 'rejected', 'failed'].map((s) => ({ value: s, label: t(`common:status.${s}`) })), { value: status, label: t('admin:approvals.filter'), onChange: (v) => { status = v; load(); } }),
      table.el, more.el);
    await load();
    liveRefresh(['approval.created'], () => load().catch(() => {}));
  },
});
