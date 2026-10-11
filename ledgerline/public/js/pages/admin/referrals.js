// Referral rewards (pending/hold, review, credited), relationships and abuse
// signals (shared signup IP or withdrawal address, sign-up bursts).
import { adminApi } from '../../api/admin-endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { can } from '../../auth/session.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { formatPercent } from '../../formatting/format-number.js';
import { t } from '../../i18n/i18n.js';
import { actionButton } from '../../components/admin/action-button.js';
import { section, userLink } from '../../components/admin/admin-ui.js';
import { emptyState } from '../../components/feedback/empty-state.js';
import { statusBadge } from '../../components/feedback/status-badge.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { dataTable } from '../../components/tables/data-table.js';
import { filterBar } from '../../components/tables/filter-bar.js';
import { loadMore } from '../../components/tables/load-more.js';

definePage({
  id: 'admin-referrals',
  area: 'admin',
  auth: 'admin',
  permission: 'referrals.read',
  namespaces: ['admin', 'referrals'],
  title: 'admin:referrals.title',
  async render({ page }) {
    let filters = {};
    const rewards = dataTable({
      columns: [
        { key: 'ref', label: t('admin:referrals.referrer'), primary: true, render: (r) => userLink(r.referrerId, r.referrerEmail) },
        { key: 'referred', label: t('admin:referrals.referred'), render: (r) => userLink(r.referredId, r.referredEmail) },
        { key: 'source', label: t('referrals:source'), render: (r) => t(`referrals:sources.${r.sourceType}`) },
        { key: 'base', label: t('referrals:base'), align: 'end', render: (r) => formatAmount(r.baseAmount, r.assetCode) },
        { key: 'rate', label: t('referrals:rate'), align: 'end', render: (r) => formatPercent(r.rate) },
        { key: 'amount', label: t('referrals:reward'), align: 'end', render: (r) => formatAmount(r.amount, r.assetCode) },
        { key: 'status', label: t('admin:users.status'), render: (r) => h('span', { class: 'stack stack--sm' }, statusBadge(r.status), r.hasOpenFlags ? h('span', { class: 'badge badge--negative' }, t('admin:referrals.flagged')) : null, r.statusReason ? h('span', { class: 'text-xs text-subtle' }, r.statusReason) : null) },
        { key: 'release', label: t('admin:referrals.releaseAt'), render: (r) => (r.releaseAt ? formatDateTime(r.releaseAt) : '—') },
        { key: 'actions', label: '', actions: true, render: (r) => (can('referrals.review') && ['pending', 'under_review'].includes(r.status) ? h('div', { class: 'cluster' },
          actionButton(t('admin:referrals.release'), { reason: t('admin:referrals.releaseText'), run: (reason) => adminApi.reviewReward(r.id, { decision: 'release', reason }), onDone: load }),
          actionButton(t('admin:referrals.cancel'), { tone: 'danger', reason: true, run: (reason) => adminApi.reviewReward(r.id, { decision: 'cancel', reason }), onDone: load })) : null) },
      ],
      empty: emptyState({ iconName: 'referrals', title: t('admin:referrals.none') }),
    });
    const more = loadMore({ onLoad: async (cursor) => { const r = await adminApi.referralRewards({ ...filters, cursor }); rewards.update(r.items, { append: true }); more.setCursor(r.nextCursor); } });
    async function load() {
      const r = await adminApi.referralRewards(filters);
      rewards.update(r.items);
      more.setCursor(r.nextCursor);
    }
    const bar = filterBar({
      fields: [
        { name: 'search', type: 'search', label: t('admin:search'), placeholder: t('admin:referrals.searchHint') },
        { name: 'status', type: 'select', label: t('admin:users.status'), options: ['pending', 'under_review', 'credited', 'cancelled'].map((s) => ({ value: s, label: t(`common:status.${s}`) })) },
      ],
      onChange: (v) => { filters = v; load(); },
    });
    filters = bar.values();

    const suspicious = h('div', { class: 'stack stack--sm' });
    const relationships = dataTable({
      columns: [
        { key: 'referrer', label: t('admin:referrals.referrer'), primary: true, render: (r) => userLink(r.referrerUserId, r.referrerEmail) },
        { key: 'referred', label: t('admin:referrals.referred'), render: (r) => userLink(r.referredUserId, r.referredEmail) },
        { key: 'code', label: t('referrals:code'), render: (r) => h('bdi', { class: 'mono', dir: 'ltr' }, r.code) },
        { key: 'deposits', label: t('admin:referrals.creditedDeposits'), align: 'end', render: (r) => String(r.creditedDeposits) },
        { key: 'date', label: t('admin:date'), render: (r) => formatDateTime(r.createdAt) },
      ],
      rowKey: (r) => r.referredUserId,
      empty: emptyState({ iconName: 'referrals', title: t('admin:none') }),
    });

    replace(page,
      pageHeader({ title: t('admin:referrals.title'), subtitle: t('admin:referrals.subtitle') }),
      h('section', { class: 'stack' }, h('h2', { class: 'section-title' }, t('admin:referrals.rewards')), bar.el, rewards.el, more.el),
      h('div', { class: 'grid grid--sidebar' }, section(t('admin:referrals.relationships'), relationships.el), section(t('admin:referrals.suspicious'), suspicious)));

    const [rel, sus] = await Promise.all([adminApi.referralRelationships({ limit: 50 }), adminApi.referralSuspicious(), load()]);
    relationships.update(rel);
    replace(suspicious,
      sus.flags.length || sus.bursts.length ? [
        ...sus.flags.map((f) => h('div', { class: 'cluster cluster--between' }, userLink(f.userId, f.email), h('span', { class: 'badge badge--negative' }, t(`admin:flags.types.${f.flagType}`)))),
        ...sus.bursts.map((b) => h('div', { class: 'cluster cluster--between' }, userLink(b.referrerUserId, b.email), h('span', { class: 'badge badge--pending' }, t('admin:referrals.burst', { count: b.referrals24h })))),
      ] : h('p', { class: 'text-small text-muted' }, t('admin:referrals.noSignals')));
  },
});
