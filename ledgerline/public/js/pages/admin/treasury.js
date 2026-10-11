// Treasury: per-asset solvency from the ledger (custody + strategy vs. user
// liabilities), reconciliation against observed balances, internal transfers
// and capital contributions — each with evidence and an idempotency key.
import { adminApi } from '../../api/admin-endpoints.js';
import { publicApi } from '../../api/endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { can } from '../../auth/session.js';
import { formatAmount, registerAssets } from '../../formatting/format-currency.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { createActionKey } from '../../services/idempotency.js';
import { coverageBadge, section } from '../../components/admin/admin-ui.js';
import { alertBox } from '../../components/feedback/alert.js';
import { errorMessage } from '../../components/feedback/error-message.js';
import { statusBadge } from '../../components/feedback/status-badge.js';
import { formField, input, select, textarea } from '../../components/forms/form-field.js';
import { setBusy, showServerErrors } from '../../components/forms/form-validation.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { confirmDialog } from '../../components/modals/confirm-dialog.js';
import { withMfa } from '../../components/modals/mfa-dialog.js';
import { toast } from '../../components/notifications/toast.js';
import { dataTable } from '../../components/tables/data-table.js';

function treasuryForm({ title, fields, submitLabel, confirmText, run, onDone }) {
  const key = createActionKey();
  const btn = h('button', { class: 'btn btn--sm btn--primary', type: 'submit' }, submitLabel);
  const form = h('form', { class: 'form', novalidate: true }, Object.values(fields).map((f) => f.el), h('div', {}, btn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (confirmText && !(await confirmDialog({ title, text: confirmText, confirmLabel: submitLabel }))) return;
    setBusy(btn, true);
    try {
      await withMfa(() => run(Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.control.value.trim()])), key.get()));
      key.reset();
      form.reset();
      toast(t('admin:done'));
      onDone?.();
    } catch (err) {
      showServerErrors(err, fields);
    } finally {
      setBusy(btn, false);
    }
  });
  return section(title, form);
}

definePage({
  id: 'admin-treasury',
  area: 'admin',
  auth: 'admin',
  permission: 'treasury.manage',
  namespaces: ['admin'],
  title: 'admin:treasury.title',
  async render({ page }) {
    const assets = await publicApi.assets();
    registerAssets(assets);
    const assetOptions = assets.map((a) => ({ value: a.code, label: a.code }));
    const integritySlot = h('div');
    const pausedSlot = h('div');
    const positions = dataTable({
      columns: [
        { key: 'asset', label: t('common:fields.asset'), primary: true, render: (p) => h('strong', {}, p.assetCode) },
        { key: 'custody', label: t('admin:treasury.custody'), align: 'end', render: (p) => formatAmount(p.custody, p.assetCode, { withAsset: false }) },
        { key: 'strategy', label: t('admin:treasury.strategy'), align: 'end', render: (p) => formatAmount(p.strategy, p.assetCode, { withAsset: false }) },
        { key: 'liabilities', label: t('admin:treasury.liabilities'), align: 'end', render: (p) => formatAmount(p.userLiabilities, p.assetCode, { withAsset: false }) },
        { key: 'suspense', label: t('admin:treasury.suspense'), align: 'end', render: (p) => formatAmount(p.suspense, p.assetCode, { withAsset: false }) },
        { key: 'equity', label: t('admin:treasury.equity'), align: 'end', render: (p) => formatAmount(p.platformEquity, p.assetCode, { withAsset: false }) },
        { key: 'coverage', label: t('admin:treasury.coverage'), render: (p) => coverageBadge(p.coverageRatio) },
        { key: 'recon', label: t('admin:treasury.lastRecon'), render: (p) => (p.lastReconciliation ? h('span', { class: 'stack stack--sm' }, statusBadge(p.lastReconciliation.status), h('span', { class: 'text-xs text-subtle' }, formatDateTime(p.lastReconciliation.createdAt))) : t('admin:treasury.never')) },
      ],
      rowKey: (p) => p.assetCode,
    });
    const history = dataTable({
      columns: [
        { key: 'asset', label: t('common:fields.asset'), primary: true, render: (r) => r.assetCode },
        { key: 'status', label: t('admin:users.status'), render: (r) => statusBadge(r.status) },
        { key: 'cd', label: t('admin:treasury.custodyDiff'), align: 'end', render: (r) => formatAmount(r.custodyDifference, r.assetCode, { withAsset: false, sign: true }) },
        { key: 'sd', label: t('admin:treasury.strategyDiff'), align: 'end', render: (r) => formatAmount(r.strategyDifference, r.assetCode, { withAsset: false, sign: true }) },
        { key: 'ev', label: t('admin:treasury.evidence'), render: (r) => h('span', { class: 'text-xs' }, r.evidence) },
        { key: 'by', label: t('admin:treasury.by'), render: (r) => h('span', { class: 'text-xs' }, r.createdByEmail || '—') },
        { key: 'date', label: t('admin:date'), render: (r) => formatDateTime(r.createdAt) },
      ],
      empty: h('p', { class: 'text-small text-muted' }, t('admin:treasury.noRecon')),
    });

    async function load() {
      const [overview, recon, integrity] = await Promise.all([adminApi.treasury(), adminApi.reconciliations(), adminApi.integrity()]);
      positions.update(overview.positions);
      history.update(recon);
      replace(pausedSlot, overview.pausedAssets.length ? alertBox({ tone: 'danger', title: t('admin:treasury.pausedTitle'), text: t('admin:treasury.pausedText', { assets: overview.pausedAssets.join(', ') }) }) : null);
      replace(integritySlot, integrity.ok
        ? alertBox({ tone: 'success', text: t('admin:treasury.integrityOk') })
        : alertBox({ tone: 'danger', title: t('admin:treasury.integrityIssues', { count: integrity.issues.length }), text: integrity.issues.slice(0, 5).map((i) => `${i.checkName}: ${i.subject} (${i.expected} / ${i.actual})`).join('; ') }));
    }

    const recon = treasuryForm({
      title: t('admin:treasury.reconcile'),
      submitLabel: t('admin:treasury.runRecon'),
      fields: {
        asset: formField({ label: t('common:fields.asset'), control: select(assetOptions), id: 'rc-asset' }),
        observedCustody: formField({ label: t('admin:treasury.observedCustody'), control: input({ inputmode: 'decimal', dir: 'ltr' }), id: 'rc-custody' }),
        observedStrategy: formField({ label: t('admin:treasury.observedStrategy'), control: input({ inputmode: 'decimal', dir: 'ltr', value: '0' }), id: 'rc-strategy' }),
        evidence: formField({ label: t('admin:treasury.evidence'), control: input({ maxLength: 300 }), hint: t('admin:treasury.evidenceHint'), id: 'rc-evidence' }),
        notes: formField({ label: t('admin:results.notes'), control: textarea({ rows: 2 }), id: 'rc-notes' }),
      },
      run: (v) => adminApi.reconcile({ ...v, notes: v.notes || undefined }),
      onDone: load,
    });
    const transfer = treasuryForm({
      title: t('admin:treasury.transfer'),
      submitLabel: t('admin:treasury.recordTransfer'),
      confirmText: t('admin:treasury.transferText'),
      fields: {
        asset: formField({ label: t('common:fields.asset'), control: select(assetOptions), id: 'tr-asset' }),
        from: formField({ label: t('admin:treasury.from'), control: select([{ value: 'custody', label: t('admin:treasury.custody') }, { value: 'strategy', label: t('admin:treasury.strategy') }]), id: 'tr-from' }),
        to: formField({ label: t('admin:treasury.to'), control: select([{ value: 'strategy', label: t('admin:treasury.strategy') }, { value: 'custody', label: t('admin:treasury.custody') }]), id: 'tr-to' }),
        amount: formField({ label: t('common:fields.amount'), control: input({ inputmode: 'decimal', dir: 'ltr' }), id: 'tr-amount' }),
        evidence: formField({ label: t('admin:treasury.evidence'), control: input({ maxLength: 300 }), id: 'tr-evidence' }),
      },
      run: (v, key) => adminApi.transfer(v, key),
      onDone: load,
    });
    const capital = treasuryForm({
      title: t('admin:treasury.capital'),
      submitLabel: t('admin:treasury.recordCapital'),
      confirmText: t('admin:treasury.capitalText'),
      fields: {
        asset: formField({ label: t('common:fields.asset'), control: select(assetOptions), id: 'cp-asset' }),
        amount: formField({ label: t('common:fields.amount'), control: input({ inputmode: 'decimal', dir: 'ltr' }), id: 'cp-amount' }),
        evidence: formField({ label: t('admin:treasury.evidence'), control: input({ maxLength: 300 }), hint: t('admin:treasury.capitalHint'), id: 'cp-evidence' }),
      },
      run: (v, key) => adminApi.capital(v, key),
      onDone: load,
    });

    replace(page,
      pageHeader({ title: t('admin:treasury.title'), subtitle: t('admin:treasury.subtitle') }),
      pausedSlot, integritySlot,
      section(t('admin:treasury.positions'), h('p', { class: 'text-xs text-subtle' }, t('admin:dashboard.solvencyHint')), positions.el),
      can('reconciliation.run') ? h('div', { class: 'grid grid--3' }, recon, transfer, capital) : null,
      section(t('admin:treasury.history'), history.el));
    try {
      await load();
    } catch (err) {
      toast(errorMessage(err), { tone: 'error' });
    }
  },
});
