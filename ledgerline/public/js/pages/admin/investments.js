// Products (terms, legal basis, status) and realised period results:
// record with evidence -> preview allocation -> second person approves ->
// post to the ledger. Nothing is ever credited without a posted result.
import { adminApi } from '../../api/admin-endpoints.js';
import { publicApi } from '../../api/endpoints.js';
import { definePage } from '../../core/page.js';
import { h, icon, replace } from '../../core/dom.js';
import { query, setQuery } from '../../core/url.js';
import { can, currentUser } from '../../auth/session.js';
import { formatAmount, registerAssets } from '../../formatting/format-currency.js';
import { formatDate, formatDateTime } from '../../formatting/format-date.js';
import { formatPercent } from '../../formatting/format-number.js';
import { localized, t } from '../../i18n/i18n.js';
import { actionButton } from '../../components/admin/action-button.js';
import { openProductForm } from '../../components/admin/product-form.js';
import { userLink } from '../../components/admin/admin-ui.js';
import { alertBox } from '../../components/feedback/alert.js';
import { emptyState } from '../../components/feedback/empty-state.js';
import { errorState } from '../../components/feedback/error-state.js';
import { skeletonRows } from '../../components/feedback/skeleton.js';
import { statusBadge } from '../../components/feedback/status-badge.js';
import { riskBadge } from '../../components/finance/product-card.js';
import { formField, input, select, textarea } from '../../components/forms/form-field.js';
import { setBusy, showServerErrors } from '../../components/forms/form-validation.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { tabs } from '../../components/misc/tabs.js';
import { openModal } from '../../components/modals/modal.js';
import { toast } from '../../components/notifications/toast.js';
import { percentToRate } from '../../validation/percent-to-rate.js';
import { dataTable } from '../../components/tables/data-table.js';

definePage({
  id: 'admin-investments',
  area: 'admin',
  auth: 'admin',
  permission: 'investments.read',
  namespaces: ['admin', 'investments'],
  title: 'admin:investments.title',
  async render({ page }) {
    const assets = await publicApi.assets();
    registerAssets(assets);
    const me = currentUser();
    let products = [];

    const productTable = dataTable({
      columns: [
        { key: 'name', label: t('admin:products.name'), primary: true, render: (p) => h('span', { class: 'stack stack--sm' }, h('strong', {}, localized(p.name) || p.slug), h('span', { class: 'text-xs text-subtle' }, `${p.slug} · v${p.version}`)) },
        { key: 'status', label: t('admin:users.status'), render: (p) => statusBadge(p.status) },
        { key: 'legal', label: t('admin:products.legalStatus'), render: (p) => t(`admin:products.legal.${p.legalStatus}`) },
        { key: 'term', label: t('investments:product.term'), render: (p) => t('investments:product.termDays', { count: p.termDays }) },
        { key: 'risk', label: t('investments:product.risk'), render: (p) => riskBadge(p.riskLevel) },
        { key: 'alloc', label: t('admin:products.allocated'), align: 'end', render: (p) => h('span', {}, formatAmount(p.allocated, p.assets[0] || 'USDT', { withAsset: false }), h('span', { class: 'text-xs text-subtle' }, ` (${p.openPositions})`)) },
        { key: 'actions', label: '', actions: true, render: (p) => (can('investments.products.manage') ? h('div', { class: 'cluster' },
          h('button', { class: 'btn btn--sm btn--ghost', type: 'button', on: { click: () => openProductForm(assets, p, { onSaved: loadProducts }) } }, t('common:actions.edit')),
          p.status !== 'active' && p.status !== 'closed' ? actionButton(t('admin:products.activate'), { confirm: t('admin:products.activateText'), run: () => adminApi.productStatus(p.id, 'active'), onDone: loadProducts }) : null,
          p.status === 'active' ? actionButton(t('admin:products.pause'), { confirm: t('admin:products.pauseText'), run: () => adminApi.productStatus(p.id, 'paused'), onDone: loadProducts }) : null,
          p.status !== 'closed' ? actionButton(t('admin:products.close'), { tone: 'danger', confirm: t('admin:products.closeText'), run: () => adminApi.productStatus(p.id, 'closed'), onDone: loadProducts }) : null) : null) },
      ],
      empty: emptyState({ iconName: 'layers', title: t('admin:products.none') }),
    });
    async function loadProducts() {
      products = await adminApi.products();
      productTable.update(products);
    }

    function previewDialog(r) {
      const body = h('div', { class: 'stack' }, skeletonRows(4));
      openModal({ title: t('admin:results.previewTitle'), body, wide: true });
      adminApi.previewResult(r.id).then(({ result, allocations }) => {
        replace(body,
          h('p', { class: 'text-small text-muted' }, t('admin:results.previewText', { count: allocations.length, rate: formatPercent(result.grossReturnRate, { max: 4, signDisplay: 'exceptZero' }) })),
          allocations.length ? dataTable({
            columns: [
              { key: 'u', label: t('admin:users.email'), primary: true, render: (a) => userLink(a.userId, a.userId.slice(0, 8)) },
              { key: 's', label: t('admin:results.share'), align: 'end', render: (a) => formatPercent(a.share, { max: 2 }) },
              { key: 'g', label: t('admin:results.gross'), align: 'end', render: (a) => formatAmount(a.gross, result.assetCode, { withAsset: false, sign: true }) },
              { key: 'f', label: t('admin:results.fee'), align: 'end', render: (a) => formatAmount(a.fee, result.assetCode, { withAsset: false }) },
              { key: 'n', label: t('admin:results.net'), align: 'end', render: (a) => formatAmount(a.net, result.assetCode, { withAsset: false, sign: true }) },
            ],
            rows: allocations,
            rowKey: (a) => a.positionId,
          }).el : h('p', { class: 'text-small text-muted' }, t('admin:results.noPositions')));
      }).catch((err) => replace(body, errorState(err)));
    }

    const resultTable = dataTable({
      columns: [
        { key: 'product', label: t('admin:products.name'), primary: true, render: (r) => localized(r.productName) || r.productSlug },
        { key: 'period', label: t('investments:product.period'), render: (r) => `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` },
        { key: 'rate', label: t('investments:product.grossReturn'), align: 'end', render: (r) => h('bdi', { dir: 'ltr' }, formatPercent(r.grossReturnRate, { max: 4, signDisplay: 'exceptZero' })) },
        { key: 'status', label: t('admin:users.status'), render: (r) => statusBadge(r.status) },
        { key: 'evidence', label: t('admin:results.evidence'), render: (r) => h('span', { class: 'text-xs' }, r.evidenceReference) },
        { key: 'by', label: t('admin:results.recordedBy'), render: (r) => h('span', { class: 'text-xs' }, r.createdByEmail, r.approvedByEmail ? h('span', { class: 'text-subtle' }, ` · ${t('admin:results.approvedBy', { email: r.approvedByEmail })}`) : null) },
        { key: 'actions', label: '', actions: true, render: (r) => h('div', { class: 'cluster' },
          r.status !== 'rejected' ? h('button', { class: 'btn btn--sm btn--ghost', type: 'button', on: { click: () => previewDialog(r) } }, t('admin:results.preview')) : null,
          r.status === 'draft' && can('investments.results.approve') && r.createdBy !== me.id ? actionButton(t('admin:results.approve'), { tone: 'primary', confirm: t('admin:results.approveText'), run: () => adminApi.resultAction(r.id, 'approve'), onDone: loadResults }) : null,
          r.status === 'draft' && r.createdBy === me.id ? h('span', { class: 'text-xs text-subtle' }, t('admin:results.needsOther')) : null,
          ['draft', 'approved'].includes(r.status) && can('investments.results.approve') ? actionButton(t('admin:results.reject'), { tone: 'danger', reason: true, run: (reason) => adminApi.resultAction(r.id, 'reject', { reason }), onDone: loadResults }) : null,
          r.status === 'approved' && can('investments.results.approve') ? actionButton(t('admin:results.post'), { tone: 'primary', confirm: t('admin:results.postText'), run: () => adminApi.resultAction(r.id, 'post'), onDone: loadResults }) : null) },
      ],
      empty: emptyState({ iconName: 'earnings', title: t('admin:results.none') }),
    });
    async function loadResults() {
      resultTable.update(await adminApi.results());
    }

    function resultForm() {
      const product = formField({ label: t('admin:products.name'), control: select(products.map((p) => ({ value: p.id, label: localized(p.name) || p.slug }))), id: 'rf-product' });
      const asset = formField({ label: t('common:fields.asset'), control: select([]), id: 'rf-asset' });
      const syncAssets = () => {
        const p = products.find((x) => x.id === product.control.value);
        asset.control.replaceChildren(...(p?.assets || []).map((a) => h('option', { value: a }, a)));
      };
      product.control.addEventListener('change', syncAssets);
      syncAssets();
      const start = formField({ label: t('admin:results.periodStart'), control: input({ type: 'datetime-local' }), id: 'rf-start' });
      const end = formField({ label: t('admin:results.periodEnd'), control: input({ type: 'datetime-local' }), hint: t('admin:results.utcHint'), id: 'rf-end' });
      const rate = formField({ label: t('admin:results.ratePercent'), control: input({ dir: 'ltr', inputmode: 'decimal', placeholder: '1.25' }), hint: t('admin:results.rateHint'), id: 'rf-rate' });
      const evidence = formField({ label: t('admin:results.evidence'), control: input({ maxLength: 300 }), hint: t('admin:results.evidenceHint'), id: 'rf-evidence' });
      const notes = formField({ label: t('admin:results.notes'), control: textarea({ rows: 3, maxLength: 2000 }), id: 'rf-notes' });
      const save = h('button', { class: 'btn btn--primary', type: 'submit', form: 'result-form' }, t('admin:results.record'));
      const form = h('form', { class: 'form', id: 'result-form', novalidate: true },
        alertBox({ tone: 'warning', text: t('admin:results.realisedOnly') }),
        h('div', { class: 'form-row' }, product.el, asset.el), h('div', { class: 'form-row' }, start.el, end.el), rate.el, evidence.el, notes.el);
      const modal = openModal({ title: t('admin:results.recordTitle'), body: form, footer: [save], wide: true });
      const toIso = (v) => (v ? new Date(`${v}:00Z`).toISOString() : '');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const grossReturnRate = percentToRate(rate.control.value);
        rate.setError(grossReturnRate === null ? t('errors:validation.invalid_rate') : '');
        if (grossReturnRate === null) return;
        setBusy(save, true);
        try {
          await adminApi.createResult({ productId: product.control.value, asset: asset.control.value, periodStart: toIso(start.control.value), periodEnd: toIso(end.control.value), grossReturnRate, evidenceReference: evidence.control.value.trim(), notes: notes.control.value.trim() || undefined });
          modal.close();
          toast(t('admin:results.recorded'));
          loadResults();
        } catch (err) {
          showServerErrors(err, { productId: product, asset, periodStart: start, periodEnd: end, grossReturnRate: rate, evidenceReference: evidence, notes });
        } finally {
          setBusy(save, false);
        }
      });
    }

    const productsPanel = h('section', { class: 'stack', id: 'panel-products', role: 'tabpanel', 'aria-labelledby': 'tab-products' },
      can('investments.products.manage') ? h('div', {}, h('button', { class: 'btn btn--primary btn--sm', type: 'button', on: { click: () => openProductForm(assets, null, { onSaved: loadProducts }) } }, icon('plus', { size: 'sm' }), t('admin:products.create'))) : null,
      alertBox({ tone: 'info', text: t('admin:products.activationRules') }),
      productTable.el);
    const resultsPanel = h('section', { class: 'stack', id: 'panel-results', role: 'tabpanel', 'aria-labelledby': 'tab-results' },
      can('investments.results.create') ? h('div', {}, h('button', { class: 'btn btn--primary btn--sm', type: 'button', on: { click: resultForm } }, icon('plus', { size: 'sm' }), t('admin:results.record'))) : null,
      alertBox({ tone: 'info', text: t('admin:results.flow') }),
      resultTable.el);
    const initial = query('tab') === 'results' ? 'results' : 'products';
    const tabBar = tabs([{ id: 'products', label: t('admin:products.tab') }, { id: 'results', label: t('admin:results.tab') }], {
      selected: initial,
      onChange: (id) => {
        productsPanel.hidden = id !== 'products';
        resultsPanel.hidden = id !== 'results';
        setQuery({ tab: id === 'results' ? 'results' : null });
      },
    });
    productsPanel.hidden = initial !== 'products';
    resultsPanel.hidden = initial !== 'results';
    replace(page, pageHeader({ title: t('admin:investments.title'), subtitle: t('admin:investments.subtitle') }), tabBar.el, productsPanel, resultsPanel);
    await Promise.all([loadProducts(), loadResults()]);
  },
});
