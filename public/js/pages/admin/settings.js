// Runtime settings and fee rules. Tightening a control applies immediately;
// relaxing it (or changing an "always" setting) creates an approval request
// for a second person. Every change needs a reason and is kept in history.
import { adminApi } from '../../api/admin-endpoints.js';
import { publicApi } from '../../api/endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { can } from '../../auth/session.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { formatPercent } from '../../formatting/format-number.js';
import { has, t } from '../../i18n/i18n.js';
import { jsonBlock, section } from '../../components/admin/admin-ui.js';
import { alertBox } from '../../components/feedback/alert.js';
import { errorMessage } from '../../components/feedback/error-message.js';
import { errorState } from '../../components/feedback/error-state.js';
import { formField, input, select, textarea } from '../../components/forms/form-field.js';
import { setBusy } from '../../components/forms/form-validation.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { reasonDialog } from '../../components/modals/confirm-dialog.js';
import { withMfa } from '../../components/modals/mfa-dialog.js';
import { openModal } from '../../components/modals/modal.js';
import { toast } from '../../components/notifications/toast.js';
import { dataTable } from '../../components/tables/data-table.js';

// Editor per value type; parse() returns the JSON value or throws 'invalid'.
function editorFor(setting) {
  const v = setting.value;
  switch (setting.type) {
    case 'boolean': {
      const c = select([{ value: 'true', label: t('admin:settings.on') }, { value: 'false', label: t('admin:settings.off') }], { value: String(v) });
      return { control: c, parse: () => c.value === 'true' };
    }
    case 'nonNegativeInt': {
      const c = input({ type: 'number', min: 0, max: 3650, value: v });
      return { control: c, parse: () => { const n = Number(c.value); if (!Number.isInteger(n) || n < 0) throw new Error('invalid'); return n; } };
    }
    case 'scope': {
      const c = select(['all_deposits', 'first_deposit'].map((s) => ({ value: s, label: t(`referrals:scope.${s}`) })), { value: v });
      return { control: c, parse: () => c.value };
    }
    case 'rate': case 'email': {
      const c = input({ value: v ?? '', dir: 'ltr' });
      return { control: c, parse: () => (setting.type === 'email' && !c.value.trim() ? null : c.value.trim()) };
    }
    case 'stringList': {
      const c = input({ value: (v || []).join(', '), dir: 'ltr' });
      return { control: c, parse: () => c.value.split(',').map((s) => s.trim()).filter(Boolean) };
    }
    default: {
      const c = textarea({ rows: 4, dir: 'ltr', class: 'textarea mono', value: JSON.stringify(v, null, 2) });
      return { control: c, parse: () => JSON.parse(c.value) };
    }
  }
}

function displayValue(s) {
  if (s.type === 'boolean') return s.value ? t('admin:settings.on') : t('admin:settings.off');
  if (s.type === 'rate') return formatPercent(s.value, { max: 4 });
  if (s.type === 'stringList') return (s.value || []).join(', ') || '—';
  if (s.value === null) return '—';
  if (typeof s.value === 'object') return jsonBlock(s.value);
  return String(s.value);
}

definePage({
  id: 'admin-settings',
  area: 'admin',
  auth: 'admin',
  permission: 'settings.read',
  namespaces: ['admin', 'referrals'],
  title: 'admin:settings.title',
  async render({ page }) {
    const assets = await publicApi.assets();

    function edit(s) {
      const ed = editorFor(s);
      const field = formField({ label: t('admin:settings.newValue'), control: ed.control, id: 'setting-value' });
      const save = h('button', { class: 'btn btn--primary', type: 'button' }, t('admin:settings.submit'));
      const modal = openModal({
        title: s.key,
        body: [h('p', { class: 'text-small text-muted' }, has(`admin:settings.keys.${s.key.replace(/\./g, '_')}`) ? t(`admin:settings.keys.${s.key.replace(/\./g, '_')}`) : s.description),
          alertBox({ tone: 'info', text: t(`admin:settings.policies.${s.approvalPolicy}`) }), field.el],
        footer: [save],
      });
      save.addEventListener('click', async () => {
        let value;
        try {
          value = ed.parse();
        } catch {
          field.setError(t('errors:validation.invalid'));
          return;
        }
        const reason = await reasonDialog({ title: t('admin:settings.reasonTitle'), text: s.key });
        if (!reason) return;
        setBusy(save, true);
        try {
          const res = await withMfa(() => adminApi.changeSetting(s.key, value, reason));
          modal.close();
          toast(res.applied ? t('admin:settings.applied') : t('admin:approvalCreated'), { tone: res.applied ? 'success' : 'info' });
          load();
        } catch (err) {
          field.setError(errorMessage(err));
        } finally {
          setBusy(save, false);
        }
      });
    }

    function historyDialog(s) {
      const body = h('div', {}, t('common:loading'));
      openModal({ title: t('admin:settings.historyTitle', { key: s.key }), body, wide: true });
      adminApi.settingHistory(s.key).then((rows) => replace(body, dataTable({
        columns: [
          { key: 'when', label: t('admin:date'), primary: true, render: (r) => formatDateTime(r.changedAt) },
          { key: 'old', label: t('admin:settings.old'), render: (r) => jsonBlock(r.oldValue) },
          { key: 'new', label: t('admin:settings.new'), render: (r) => jsonBlock(r.newValue) },
          { key: 'by', label: t('admin:treasury.by'), render: (r) => h('span', { class: 'text-xs' }, r.changedByEmail || '—') },
          { key: 'reason', label: t('common:fields.reason'), render: (r) => h('span', { class: 'text-xs' }, r.reason || '—', r.approvalId ? h('span', { class: 'text-subtle' }, ` · ${t('admin:settings.viaApproval')}`) : null) },
        ],
        rows: rows.map((r, i) => ({ ...r, id: i })),
        empty: h('p', { class: 'text-small text-muted' }, t('admin:none')),
      }).el)).catch((err) => replace(body, errorState(err)));
    }

    const table = dataTable({
      columns: [
        { key: 'key', label: t('admin:settings.key'), primary: true, render: (s) => h('span', { class: 'stack stack--sm' }, h('code', { dir: 'ltr' }, s.key), h('span', { class: 'text-xs text-subtle' }, has(`admin:settings.keys.${s.key.replace(/\./g, '_')}`) ? t(`admin:settings.keys.${s.key.replace(/\./g, '_')}`) : s.description)) },
        { key: 'value', label: t('admin:settings.value'), render: displayValue },
        { key: 'policy', label: t('admin:settings.policy'), render: (s) => h('span', { class: 'text-xs' }, t(`admin:settings.policyShort.${s.approvalPolicy}`)) },
        { key: 'pending', label: t('admin:settings.pending'), render: (s) => (s.pendingChange ? h('a', { href: '/admin/approvals', class: 'badge badge--pending' }, t('admin:settings.pendingChange')) : '') },
        { key: 'updated', label: t('admin:settings.updated'), render: (s) => formatDateTime(s.updatedAt) },
        { key: 'actions', label: '', actions: true, render: (s) => h('div', { class: 'cluster' },
          can('settings.request') ? h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => edit(s) } }, t('common:actions.edit')) : null,
          h('button', { class: 'btn btn--sm btn--ghost', type: 'button', on: { click: () => historyDialog(s) } }, t('admin:settings.history'))) },
      ],
      rowKey: (s) => s.key,
    });

    const feeTable = dataTable({
      columns: [
        { key: 'scope', label: t('admin:fees.scope'), primary: true, render: (r) => `${r.assetCode || t('admin:fees.allAssets')} · ${r.networkCode || t('admin:fees.allNetworks')}` },
        { key: 'rate', label: t('admin:fees.rate'), align: 'end', render: (r) => formatPercent(r.rate, { max: 4 }) },
        { key: 'min', label: t('admin:fees.minFee'), align: 'end', render: (r) => r.minFee },
        { key: 'from', label: t('admin:fees.from'), render: (r) => formatDateTime(r.effectiveFrom) },
        { key: 'to', label: t('admin:fees.to'), render: (r) => (r.effectiveTo ? formatDateTime(r.effectiveTo) : t('admin:fees.current')) },
        { key: 'reason', label: t('common:fields.reason'), render: (r) => h('span', { class: 'text-xs' }, r.changeReason) },
      ],
    });

    const pairs = [{ value: '|', label: t('admin:fees.default') }, ...assets.flatMap((a) => [{ value: `${a.code}|`, label: `${a.code} · ${t('admin:fees.allNetworks')}` }, ...a.networks.map((n) => ({ value: `${a.code}|${n.code}`, label: `${a.code} · ${n.name}` }))])];
    const scope = formField({ label: t('admin:fees.scope'), control: select(pairs), id: 'fee-scope' });
    const rate = formField({ label: t('admin:fees.rate'), control: input({ dir: 'ltr', placeholder: '0.03' }), hint: t('admin:products.rateHint'), id: 'fee-rate' });
    const minFee = formField({ label: t('admin:fees.minFee'), control: input({ dir: 'ltr', value: '0' }), id: 'fee-min' });
    const feeBtn = h('button', { class: 'btn btn--sm btn--primary', type: 'submit' }, t('admin:fees.request'));
    const feeForm = h('form', { class: 'form', novalidate: true }, scope.el, h('div', { class: 'form-row' }, rate.el, minFee.el), h('div', {}, feeBtn));
    feeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = await reasonDialog({ title: t('admin:fees.request') });
      if (!reason) return;
      const [asset, network] = scope.control.value.split('|');
      setBusy(feeBtn, true);
      try {
        const res = await withMfa(() => adminApi.requestFeeRule({ asset: asset || null, network: network || null, rate: rate.control.value.trim(), minFee: minFee.control.value.trim() || '0', reason }));
        toast(res?.status === 'executed' ? t('admin:done') : t('admin:approvalCreated'), { tone: res?.status === 'executed' ? 'success' : 'info' });
        feeForm.reset();
        load();
      } catch (err) {
        rate.setError(errorMessage(err));
      } finally {
        setBusy(feeBtn, false);
      }
    });

    async function load() {
      const [settings, fees] = await Promise.all([adminApi.settings(), adminApi.feeRules()]);
      table.update(settings);
      feeTable.update(fees);
    }

    replace(page,
      pageHeader({ title: t('admin:settings.title'), subtitle: t('admin:settings.subtitle') }),
      alertBox({ tone: 'info', text: t('admin:settings.rules') }),
      section(t('admin:settings.runtime'), table.el),
      h('div', { class: 'grid grid--sidebar' },
        section(t('admin:fees.title'), h('p', { class: 'text-xs text-subtle' }, t('admin:fees.hint')), feeTable.el),
        can('settings.request') ? section(t('admin:fees.new'), feeForm) : null));
    await load();
  },
});
