// Deposits: every incoming payment with its chain evidence; review queue
// (screening holds, suspense), return of funds, and the address pool.
import { adminApi } from '../../api/admin-endpoints.js';
import { publicApi } from '../../api/endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { query, setQuery } from '../../core/url.js';
import { can } from '../../auth/session.js';
import { formatAmount, registerAssets } from '../../formatting/format-currency.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { liveRefresh } from '../../services/live-refresh.js';
import { actionButton } from '../../components/admin/action-button.js';
import { jsonBlock, section, userLink } from '../../components/admin/admin-ui.js';
import { simulateDepositForm } from '../../components/admin/demo-tools.js';
import { depositMethodsPanel } from '../../components/admin/deposit-methods.js';
import { emptyState } from '../../components/feedback/empty-state.js';
import { errorState } from '../../components/feedback/error-state.js';
import { skeletonRows } from '../../components/feedback/skeleton.js';
import { statusBadge } from '../../components/feedback/status-badge.js';
import { confirmationProgress } from '../../components/finance/confirmation-progress.js';
import { formField, input, select, textarea } from '../../components/forms/form-field.js';
import { setBusy, showServerErrors } from '../../components/forms/form-validation.js';
import { addressBox, inlineHash } from '../../components/misc/address-display.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { tabs } from '../../components/misc/tabs.js';
import { openModal } from '../../components/modals/modal.js';
import { toast } from '../../components/notifications/toast.js';
import { errorMessage } from '../../components/feedback/error-message.js';
import { dataTable } from '../../components/tables/data-table.js';
import { filterBar } from '../../components/tables/filter-bar.js';
import { loadMore } from '../../components/tables/load-more.js';

const STATUSES = ['awaiting_payment', 'detected', 'confirming', 'confirmed', 'under_review', 'credited', 'failed', 'rejected'];

definePage({
  id: 'admin-deposits',
  area: 'admin',
  auth: 'admin',
  permission: 'deposits.read',
  namespaces: ['admin', 'deposit', 'transactions'],
  title: 'admin:deposits.title',
  async render({ page, config }) {
    const assets = await publicApi.assets();
    registerAssets(assets);
    let filters = {};

    function openDetail(id) {
      const body = h('div', { class: 'stack' }, skeletonRows(5));
      const modal = openModal({ title: t('admin:deposits.detail'), body, wide: true });
      adminApi.deposit(id).then((d) => {
        const after = () => { modal.close(); load(); };
        const actions = [];
        const manual = d.source === 'manual';
        let manualBox = null;
        if (manual && d.status === 'under_review' && can('deposits.review')) {
          // A reported payment: credit it only after finding it on the blockchain.
          const amountField = formField({ label: t('admin:manual.confirmedAmount'), control: input({ dir: 'ltr', inputmode: 'decimal', value: d.claimedAmount || d.amount || '' }), hint: t('admin:manual.confirmedAmountHint'), id: 'man-amount' });
          const hashField = formField({ label: t('transactions:txHash'), control: input({ dir: 'ltr', class: 'input input--mono', value: d.txHash || '', spellcheck: false }), hint: t('admin:manual.txHashHint'), id: 'man-hash' });
          manualBox = h('section', { class: 'card card--sunken stack' },
            h('h3', { class: 'card__title' }, t('admin:manual.title')),
            h('p', { class: 'text-small text-muted' }, t('admin:manual.text')),
            h('div', { class: 'form-row' }, amountField.el, hashField.el),
            h('div', { class: 'cluster' },
              actionButton(t('admin:manual.approve'), {
                tone: 'primary',
                reason: t('admin:manual.approveText'),
                run: (reason) => adminApi.approveManualDeposit(id, { amount: amountField.control.value.trim() || undefined, txHash: hashField.control.value.trim() || undefined, reason }),
                done: t('admin:manual.approved'),
                onDone: after,
              }),
              actionButton(t('admin:deposits.reject'), { tone: 'danger', reason: t('admin:manual.rejectText'), run: (reason) => adminApi.reviewDeposit(id, { decision: 'reject', reason }), onDone: after })));
        } else if (can('deposits.review') && ['confirmed', 'under_review', 'confirming', 'detected'].includes(d.status)) {
          if (d.status !== 'under_review') actions.push(actionButton(t('admin:deposits.hold'), { reason: true, run: (reason) => adminApi.reviewDeposit(id, { decision: 'hold', reason }), onDone: after }));
          if (['under_review', 'confirmed'].includes(d.status)) actions.push(actionButton(t('admin:deposits.approve'), { tone: 'primary', reason: t('admin:deposits.approveText'), run: (reason) => adminApi.reviewDeposit(id, { decision: 'approve', reason }), onDone: after }));
          actions.push(actionButton(t('admin:deposits.reject'), { tone: 'danger', reason: t('admin:deposits.rejectText'), run: (reason) => adminApi.reviewDeposit(id, { decision: 'reject', reason }), onDone: after }));
        }
        if (can('deposits.return') && d.status === 'rejected' && !d.refundTxHash) {
          const hash = formField({ label: t('admin:deposits.refundHash'), control: input({ dir: 'ltr', class: 'input input--mono' }), id: 'refund-hash', hint: t('admin:deposits.refundHint') });
          actions.push(h('div', { class: 'stack stack--sm' }, hash.el, actionButton(t('admin:deposits.markReturned'), { confirm: t('admin:deposits.returnText'), run: () => adminApi.returnDeposit(id, { txHash: hash.control.value.trim() }), onDone: after })));
        }
        // A report that never reached the ledger (duplicate, test, mistake) can be deleted.
        if (manual && d.status !== 'credited' && can('deposits.review')) {
          actions.push(actionButton(t('admin:manual.delete'), { tone: 'danger', confirm: t('admin:manual.deleteText'), done: t('admin:manual.deleted'), run: () => adminApi.deleteDepositReport(id), onDone: after }));
        }
        if (config.demoTools && can('demo.tools') && ['detected', 'confirming'].includes(d.status)) {
          actions.push(actionButton(t('admin:demo.addConfirmations'), { run: () => adminApi.advanceConfirmations({ depositId: id, confirmations: d.requiredConfirmations }), onDone: after }));
        }
        replace(body,
          h('dl', { class: 'kv' },
            h('dt', {}, t('admin:reference')), h('dd', {}, h('bdi', { class: 'mono', dir: 'ltr' }, d.reference)),
            h('dt', {}, t('admin:users.email')), h('dd', {}, userLink(d.userId, d.email)),
            h('dt', {}, t('admin:users.status')), h('dd', {}, statusBadge(d.status), d.statusReason && d.statusReason !== 'manual_report' ? h('span', { class: 'text-xs text-subtle' }, ` ${d.statusReason}`) : null),
            h('dt', {}, t('admin:manual.source')), h('dd', {}, manual ? h('span', { class: 'badge badge--pending' }, t('admin:manual.sourceManual')) : t('admin:manual.sourceChain'), d.methodLabel ? h('span', { class: 'text-xs text-subtle' }, ` ${d.methodLabel}`) : null),
            h('dt', {}, t('common:fields.amount')), h('dd', { class: 'num' }, d.amount ? formatAmount(d.amount, d.assetCode) : '—'),
            manual && d.claimedAmount ? [h('dt', {}, t('admin:manual.claimed')), h('dd', { class: 'num' }, formatAmount(d.claimedAmount, d.assetCode))] : null,
            manual && d.userNote ? [h('dt', {}, t('admin:manual.userNote')), h('dd', {}, d.userNote)] : null,
            h('dt', {}, t('common:fields.network')), h('dd', {}, `${d.assetCode} · ${d.networkCode}`),
            manual ? null : [h('dt', {}, t('deposit:confirmationsLabel')), h('dd', {}, confirmationProgress(d.confirmations, d.requiredConfirmations))],
            manual ? null : [h('dt', {}, t('admin:deposits.risk')), h('dd', {}, d.riskResult ? t(`admin:deposits.riskResults.${d.riskResult}`) : '—')],
            h('dt', {}, t('transactions:txHash')), h('dd', {}, inlineHash(d.txHash, { href: d.explorerUrl })),
            manual && !d.fromAddress ? null : [h('dt', {}, t('admin:deposits.from')), h('dd', {}, d.fromAddress ? inlineHash(d.fromAddress) : '—')],
            h('dt', {}, t('admin:date')), h('dd', {}, formatDateTime(d.createdAt))),
          d.address ? h('div', { class: 'stack stack--sm' }, h('span', { class: 'field__label' }, t('admin:deposits.toAddress')), addressBox(d.address), d.memo ? h('span', { class: 'text-small' }, `${t('deposit:memo')}: ${d.memo}`) : null) : null,
          manualBox,
          manual ? null : h('section', { class: 'stack stack--sm' }, h('h3', { class: 'section-title' }, t('admin:deposits.events')),
            d.events.length ? dataTable({
              columns: [
                { key: 'p', label: t('admin:deposits.provider'), primary: true, render: (e) => e.provider },
                { key: 'c', label: t('deposit:confirmationsLabel'), align: 'end', render: (e) => String(e.confirmations) },
                { key: 'b', label: t('admin:deposits.block'), render: (e) => e.blockNumber ?? '—' },
                { key: 'r', label: t('admin:deposits.result'), render: (e) => (e.reorged ? t('admin:deposits.reorged') : e.processingResult || '—') },
                { key: 'd', label: t('admin:date'), render: (e) => formatDateTime(e.receivedAt) },
              ],
              rows: d.events,
            }).el : h('p', { class: 'text-small text-muted' }, t('admin:none'))),
          actions.length ? h('div', { class: 'cluster' }, actions) : null);
      }).catch((err) => replace(body, errorState(err)));
    }

    const list = dataTable({
      columns: [
        { key: 'ref', label: t('admin:reference'), primary: true, render: (d) => h('bdi', { class: 'mono', dir: 'ltr' }, d.reference) },
        { key: 'user', label: t('admin:users.email'), render: (d) => userLink(d.userId, d.email) },
        { key: 'amount', label: t('common:fields.amount'), align: 'end', render: (d) => (d.amount ? formatAmount(d.amount, d.assetCode) : `${d.assetCode} · —`) },
        { key: 'net', label: t('common:fields.network'), render: (d) => d.networkCode },
        { key: 'status', label: t('admin:users.status'), render: (d) => h('span', { class: 'cluster cluster--tight' },
          ['detected', 'confirming'].includes(d.status) ? confirmationProgress(d.confirmations, d.requiredConfirmations) : statusBadge(d.status),
          d.source === 'manual' ? h('span', { class: 'badge badge--plain', title: t('admin:manual.sourceManual') }, t('admin:manual.reported')) : null) },
        { key: 'risk', label: t('admin:deposits.risk'), render: (d) => (d.riskResult ? t(`admin:deposits.riskResults.${d.riskResult}`) : '—') },
        { key: 'date', label: t('admin:date'), render: (d) => formatDateTime(d.createdAt) },
      ],
      onRowClick: (d) => openDetail(d.id),
      empty: emptyState({ iconName: 'deposit', title: t('admin:deposits.none') }),
    });
    const more = loadMore({ onLoad: async (cursor) => { const r = await adminApi.deposits({ ...filters, cursor }); list.update(r.items, { append: true }); more.setCursor(r.nextCursor); } });
    async function load() {
      const r = await adminApi.deposits(filters);
      list.update(r.items);
      more.setCursor(r.nextCursor);
    }
    const bar = filterBar({
      fields: [
        { name: 'search', type: 'search', label: t('admin:search'), placeholder: t('admin:deposits.searchHint') },
        { name: 'status', type: 'select', label: t('admin:users.status'), options: STATUSES.map((s) => ({ value: s, label: t(`common:status.${s}`) })) },
        { name: 'source', type: 'select', label: t('admin:manual.source'), options: [{ value: 'manual', label: t('admin:manual.sourceManual') }, { value: 'chain', label: t('admin:manual.sourceChain') }] },
        { name: 'asset', type: 'select', label: t('common:fields.asset'), options: assets.map((a) => ({ value: a.code, label: a.code })) },
      ],
      onChange: (v) => { filters = v; load(); },
    });
    filters = bar.values();

    // Address pool: counts per network, import of externally generated addresses.
    const poolTable = dataTable({ columns: [
      { key: 'n', label: t('common:fields.network'), primary: true, render: (r) => r.networkCode },
      { key: 's', label: t('admin:users.status'), render: (r) => t(`admin:pool.statuses.${r.status}`) },
      { key: 'c', label: t('admin:pool.count'), align: 'end', render: (r) => String(r.count) },
    ], rowKey: (r) => `${r.networkCode}:${r.status}` });
    async function loadPool() { poolTable.update(await adminApi.addressPool()); }
    const networks = assets.flatMap((a) => a.networks).filter((n, i, arr) => arr.findIndex((x) => x.code === n.code) === i);
    const net = formField({ label: t('common:fields.network'), control: select(networks.map((n) => ({ value: n.code, label: n.name }))), id: 'pool-net' });
    const addrs = formField({ label: t('admin:pool.addresses'), control: textarea({ rows: 6, dir: 'ltr', spellcheck: false }), hint: t('admin:pool.addressesHint'), id: 'pool-addrs' });
    const shared = formField({ label: t('admin:pool.shared'), control: input({ dir: 'ltr' }), hint: t('admin:pool.sharedHint'), id: 'pool-shared' });
    const memoCount = formField({ label: t('admin:pool.memoCount'), control: input({ type: 'number', min: 1, max: 5000 }), id: 'pool-memos' });
    const importBtn = h('button', { class: 'btn btn--sm btn--primary', type: 'submit' }, t('admin:pool.import'));
    const importForm = h('form', { class: 'form', novalidate: true }, net.el, addrs.el, h('div', { class: 'form-row' }, shared.el, memoCount.el), h('div', {}, importBtn));
    const syncMemo = () => {
      const n = networks.find((x) => x.code === net.control.value);
      shared.el.hidden = !n?.memoRequired;
      memoCount.el.hidden = !n?.memoRequired;
      addrs.el.hidden = Boolean(n?.memoRequired);
    };
    net.control.addEventListener('change', syncMemo);
    syncMemo();
    importForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setBusy(importBtn, true);
      try {
        const n = networks.find((x) => x.code === net.control.value);
        const body = n.memoRequired
          ? { network: n.code, sharedAddress: shared.control.value.trim(), memoCount: Number(memoCount.control.value) }
          : { network: n.code, addresses: addrs.control.value.split(/\s+/).map((s) => s.trim()).filter(Boolean) };
        const res = await adminApi.importAddresses(body);
        toast(t('admin:pool.imported', { inserted: res.inserted, skipped: res.skipped }));
        importForm.reset();
        syncMemo();
        loadPool();
      } catch (err) {
        showServerErrors(err, { addresses: addrs, sharedAddress: shared, memoCount, network: net });
      } finally {
        setBusy(importBtn, false);
      }
    });

    const listPanel = h('section', { class: 'stack', id: 'panel-list', role: 'tabpanel', 'aria-labelledby': 'tab-list' },
      config.demoTools && can('demo.tools') ? h('details', { class: 'disclosure' }, h('summary', {}, t('admin:demo.simulateTitle')), h('div', { class: 'disclosure__body' }, simulateDepositForm(assets, { onDone: load }))) : null,
      bar.el, list.el, more.el);
    const poolPanel = h('section', { class: 'stack', id: 'panel-pool', role: 'tabpanel', 'aria-labelledby': 'tab-pool' },
      h('div', { class: 'grid grid--2' }, section(t('admin:pool.title'), h('p', { class: 'text-xs text-subtle' }, t('admin:pool.hint')), poolTable.el),
        can('addresses.manage') ? section(t('admin:pool.importTitle'), importForm) : null));
    const methods = depositMethodsPanel({ assets });
    const methodsPanel = h('section', { class: 'stack', id: 'panel-methods', role: 'tabpanel', 'aria-labelledby': 'tab-methods' }, methods.el);
    const panels = { list: listPanel, methods: methodsPanel, pool: poolPanel };
    const initial = ['pool', 'methods'].includes(query('tab')) ? query('tab') : 'list';
    const loadTab = (id) => {
      if (id === 'pool') loadPool();
      if (id === 'methods') methods.load().catch((err) => toast(errorMessage(err), { tone: 'error' }));
    };
    const tabBar = tabs([{ id: 'list', label: t('admin:deposits.tab') }, { id: 'methods', label: t('admin:methods.tab') }, { id: 'pool', label: t('admin:pool.tab') }], {
      selected: initial,
      onChange: (id) => {
        Object.entries(panels).forEach(([key, panel]) => { panel.hidden = key !== id; });
        setQuery({ tab: id === 'list' ? null : id });
        loadTab(id);
      },
    });
    Object.entries(panels).forEach(([key, panel]) => { panel.hidden = key !== initial; });
    replace(page, pageHeader({ title: t('admin:deposits.title'), subtitle: t('admin:deposits.subtitle') }), tabBar.el, listPanel, methodsPanel, poolPanel);
    await load();
    loadTab(initial);
    liveRefresh(['deposit.updated', 'deposit.unknown_address', 'deposit.unknown_asset', 'address_pool.empty'], () => load().catch(() => {}));
  },
});
