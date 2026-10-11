// Users: search (email, id, referral code), filters, and the risk-flag queue.
import { adminApi } from '../../api/admin-endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { query, setQuery } from '../../core/url.js';
import { can } from '../../auth/session.js';
import { formatDateTime, formatRelative } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { actionButton } from '../../components/admin/action-button.js';
import { jsonBlock, userLink } from '../../components/admin/admin-ui.js';
import { emptyState } from '../../components/feedback/empty-state.js';
import { statusBadge } from '../../components/feedback/status-badge.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { tabs } from '../../components/misc/tabs.js';
import { dataTable } from '../../components/tables/data-table.js';
import { filterBar } from '../../components/tables/filter-bar.js';
import { loadMore } from '../../components/tables/load-more.js';

definePage({
  id: 'admin-users',
  area: 'admin',
  auth: 'admin',
  permission: 'users.read',
  namespaces: ['admin'],
  title: 'admin:users.title',
  async render({ page }) {
    let filters = {};
    const users = dataTable({
      columns: [
        { key: 'email', label: t('admin:users.email'), primary: true, render: (u) => h('span', { class: 'stack stack--sm' }, userLink(u.id, u.email), u.roles.length ? h('span', { class: 'text-xs text-subtle' }, u.roles.map((r) => t(`admin:roles.${r}`)).join(', ')) : null) },
        { key: 'status', label: t('admin:users.status'), render: (u) => statusBadge(u.status) },
        { key: 'kyc', label: t('admin:users.kyc'), render: (u) => statusBadge(u.kycStatus === 'approved' ? 'approved_kyc' : u.kycStatus, { label: t(`admin:kyc.${u.kycStatus}`) }) },
        { key: 'mfa', label: t('admin:users.mfa'), render: (u) => (u.mfaEnabled ? t('admin:yes') : t('admin:no')) },
        { key: 'flags', label: t('admin:users.flags'), align: 'end', render: (u) => (u.openFlags ? h('span', { class: 'badge badge--negative' }, String(u.openFlags)) : '0') },
        { key: 'country', label: t('admin:users.country'), render: (u) => u.countryCode || '—' },
        { key: 'created', label: t('admin:users.created'), render: (u) => formatDateTime(u.createdAt) },
        { key: 'login', label: t('admin:users.lastLogin'), render: (u) => (u.lastLoginAt ? formatRelative(u.lastLoginAt) : '—') },
      ],
      onRowClick: (u) => location.assign(`/admin/user?id=${u.id}`),
      empty: emptyState({ iconName: 'users', title: t('admin:users.none') }),
    });
    const more = loadMore({ onLoad: async (cursor) => { const r = await adminApi.users({ ...filters, cursor }); users.update(r.items, { append: true }); more.setCursor(r.nextCursor); } });
    async function loadUsers() {
      const r = await adminApi.users(filters);
      users.update(r.items);
      more.setCursor(r.nextCursor);
    }
    const bar = filterBar({
      fields: [
        { name: 'search', type: 'search', label: t('admin:users.search'), placeholder: t('admin:users.searchHint') },
        { name: 'status', type: 'select', label: t('admin:users.status'), options: ['active', 'restricted', 'frozen', 'closed'].map((s) => ({ value: s, label: t(`common:status.${s}`) })) },
        { name: 'kyc', type: 'select', label: t('admin:users.kyc'), options: ['none', 'pending', 'approved', 'rejected'].map((s) => ({ value: s, label: t(`admin:kyc.${s}`) })) },
        { name: 'staff', type: 'select', label: t('admin:users.staff'), options: [{ value: 'true', label: t('admin:users.staffOnly') }] },
      ],
      onChange: (v) => { filters = v; loadUsers(); },
    });
    filters = bar.values();

    const flags = dataTable({
      columns: [
        { key: 'user', label: t('admin:users.email'), primary: true, render: (f) => userLink(f.userId, f.email) },
        { key: 'type', label: t('admin:flags.type'), render: (f) => t(`admin:flags.types.${f.flagType}`) },
        { key: 'severity', label: t('admin:flags.severity'), render: (f) => h('span', { class: `badge badge--${f.severity === 'high' ? 'negative' : f.severity === 'medium' ? 'pending' : 'neutral'}` }, t(`admin:flags.severities.${f.severity}`)) },
        { key: 'details', label: t('admin:flags.details'), render: (f) => h('details', {}, h('summary', {}, t('admin:show')), jsonBlock(f.details)) },
        { key: 'created', label: t('admin:users.created'), render: (f) => formatDateTime(f.createdAt) },
        { key: 'actions', label: '', actions: true, render: (f) => (can('risk.manage') && f.status === 'open'
          ? h('div', { class: 'cluster' },
              actionButton(t('admin:flags.resolve'), { reason: true, run: (note) => adminApi.resolveFlag(f.id, { resolution: 'resolved', note }), onDone: loadFlags }),
              actionButton(t('admin:flags.dismiss'), { reason: true, run: (note) => adminApi.resolveFlag(f.id, { resolution: 'dismissed', note }), onDone: loadFlags }))
          : statusBadge(f.status)) },
      ],
      empty: emptyState({ iconName: 'shield', title: t('admin:flags.none') }),
    });
    async function loadFlags() {
      const r = await adminApi.riskFlags({ status: 'open', limit: 100 });
      flags.update(r.items);
    }

    const usersPanel = h('section', { class: 'stack', id: 'panel-users', role: 'tabpanel', 'aria-labelledby': 'tab-users' }, bar.el, users.el, more.el);
    const flagsPanel = h('section', { class: 'stack', id: 'panel-flags', role: 'tabpanel', 'aria-labelledby': 'tab-flags' }, h('p', { class: 'text-small text-muted' }, t('admin:flags.hint')), flags.el);
    const initial = query('tab') === 'flags' ? 'flags' : 'users';
    const tabBar = tabs([{ id: 'users', label: t('admin:users.tab') }, { id: 'flags', label: t('admin:flags.tab') }], {
      selected: initial,
      onChange: (id) => {
        usersPanel.hidden = id !== 'users';
        flagsPanel.hidden = id !== 'flags';
        setQuery({ tab: id === 'flags' ? 'flags' : null });
        if (id === 'flags') loadFlags();
      },
    });
    usersPanel.hidden = initial !== 'users';
    flagsPanel.hidden = initial !== 'flags';
    replace(page, pageHeader({ title: t('admin:users.title'), subtitle: t('admin:users.subtitle') }), tabBar.el, usersPanel, flagsPanel);
    await (initial === 'flags' ? loadFlags() : loadUsers());
    if (initial === 'flags') loadUsers();
  },
});
