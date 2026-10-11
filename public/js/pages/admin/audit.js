// Audit log: append-only record of every staff action and every automated
// financial decision, with before/after state and the stated reason.
import { adminApi } from '../../api/admin-endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { query } from '../../core/url.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { jsonBlock, userLink } from '../../components/admin/admin-ui.js';
import { emptyState } from '../../components/feedback/empty-state.js';
import { setBusy } from '../../components/forms/form-validation.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { dataTable } from '../../components/tables/data-table.js';
import { filterBar } from '../../components/tables/filter-bar.js';

definePage({
  id: 'admin-audit',
  area: 'admin',
  auth: 'admin',
  permission: 'audit.read',
  namespaces: ['admin'],
  title: 'admin:audit.title',
  async render({ page }) {
    let filters = { entityType: query('entityType') || undefined, entityId: query('entityId') || undefined };
    let before = null;
    const table = dataTable({
      columns: [
        { key: 'when', label: t('admin:date'), primary: true, render: (a) => h('span', { class: 'nowrap' }, formatDateTime(a.createdAt)) },
        { key: 'actor', label: t('admin:audit.actor'), render: (a) => (a.actorId ? h('span', { class: 'stack stack--sm' }, userLink(a.actorId, a.actorEmail), h('span', { class: 'text-xs text-subtle' }, (a.actorRoles || []).join(', '))) : t('admin:audit.system')) },
        { key: 'action', label: t('admin:audit.action'), render: (a) => h('code', { dir: 'ltr' }, a.action) },
        { key: 'entity', label: t('admin:audit.entity'), render: (a) => h('span', { class: 'text-xs', dir: 'ltr' }, `${a.entityType}${a.entityId ? ` · ${String(a.entityId).slice(0, 8)}` : ''}`) },
        { key: 'reason', label: t('common:fields.reason'), render: (a) => h('span', { class: 'text-small' }, a.reason || '—') },
        { key: 'change', label: t('admin:audit.change'), render: (a) => (a.beforeState || a.afterState ? h('details', {}, h('summary', {}, t('admin:show')), h('div', { class: 'grid grid--2' }, jsonBlock(a.beforeState), jsonBlock(a.afterState))) : '—') },
      ],
      empty: emptyState({ iconName: 'file', title: t('admin:audit.none') }),
    });
    const moreBtn = h('button', { class: 'btn btn--sm', type: 'button', hidden: true }, t('common:actions.showMore'));
    async function load(append = false) {
      const r = await adminApi.audit({ ...filters, before: append ? before : undefined });
      table.update(r.items, { append });
      before = r.nextBefore;
      moreBtn.hidden = !before;
    }
    moreBtn.addEventListener('click', async () => {
      setBusy(moreBtn, true);
      try { await load(true); } finally { setBusy(moreBtn, false); }
    });
    const bar = filterBar({
      fields: [
        { name: 'entityType', type: 'search', label: t('admin:audit.entityType'), placeholder: 'withdrawal_request' },
        { name: 'entityId', type: 'search', label: t('admin:audit.entityId') },
      ],
      onChange: (v) => { filters = v; load(); },
    });
    replace(page, pageHeader({ title: t('admin:audit.title'), subtitle: t('admin:audit.subtitle') }), bar.el, table.el, h('div', { class: 'pagination' }, moreBtn));
    await load();
  },
});
