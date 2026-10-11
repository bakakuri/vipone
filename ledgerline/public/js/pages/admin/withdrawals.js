// Withdrawal queue. Four-eyes rules are enforced by the database: large
// requests need two approvers, and the person who sends the funds cannot be
// the one who confirms completion.
import { adminApi } from '../../api/admin-endpoints.js';
import { publicApi } from '../../api/endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { can } from '../../auth/session.js';
import { formatAmount, registerAssets } from '../../formatting/format-currency.js';
import { formatDateTime, formatRelative } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { liveRefresh } from '../../services/live-refresh.js';
import { actionButton } from '../../components/admin/action-button.js';
import { section, userLink } from '../../components/admin/admin-ui.js';
import { demoTxHash } from '../../components/admin/demo-tools.js';
import { alertBox } from '../../components/feedback/alert.js';
import { emptyState } from '../../components/feedback/empty-state.js';
import { errorState } from '../../components/feedback/error-state.js';
import { skeletonRows } from '../../components/feedback/skeleton.js';
import { statusBadge } from '../../components/feedback/status-badge.js';
import { checkbox, formField, input } from '../../components/forms/form-field.js';
import { addressBox, inlineHash } from '../../components/misc/address-display.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { openModal } from '../../components/modals/modal.js';
import { dataTable } from '../../components/tables/data-table.js';
import { filterBar } from '../../components/tables/filter-bar.js';
import { loadMore } from '../../components/tables/load-more.js';

const STATUSES = ['pending', 'under_review', 'approved', 'processing', 'completed', 'rejected', 'failed', 'cancelled'];

definePage({
  id: 'admin-withdrawals',
  area: 'admin',
  auth: 'admin',
  permission: 'withdrawals.read',
  namespaces: ['admin', 'withdrawal', 'transactions'],
  title: 'admin:withdrawals.title',
  async render({ page, config }) {
    registerAssets(await publicApi.assets());
    let filters = {};

    function openDetail(id) {
      const body = h('div', { class: 'stack' }, skeletonRows(6));
      const modal = openModal({ title: t('admin:withdrawals.detail'), body, wide: true });
      adminApi.withdrawal(id).then((w) => {
        const after = () => { modal.close(); load(); };
        const act = (action, extra = {}) => (input) => adminApi.withdrawalAction(id, action, typeof input === 'string' ? { reason: input, ...extra } : extra);
        const actions = [];
        const open = ['pending', 'under_review'].includes(w.status);
        if (open && can('withdrawals.review') && w.status === 'pending') actions.push(actionButton(t('admin:withdrawals.review'), { reason: t('admin:withdrawals.reviewText'), run: act('review'), onDone: after }));
        if (open && can('withdrawals.approve')) actions.push(actionButton(w.statusReason === 'awaiting_second_approval' ? t('admin:withdrawals.secondApprove') : t('admin:withdrawals.approve'), { tone: 'primary', confirm: t('admin:withdrawals.approveText'), run: act('approve'), onDone: after }));
        if (open && can('withdrawals.review')) actions.push(actionButton(t('admin:withdrawals.reject'), { tone: 'danger', reason: t('admin:withdrawals.rejectText'), run: act('reject'), onDone: after }));
        if (w.status === 'approved' && can('withdrawals.process')) actions.push(actionButton(t('admin:withdrawals.process'), { confirm: t('admin:withdrawals.processText'), run: act('process'), onDone: after }));
        if (w.status === 'processing' && can('withdrawals.process') && !w.txHash) {
          const hash = formField({ label: t('transactions:txHash'), control: input({ dir: 'ltr', class: 'input input--mono' }), id: 'wd-hash', hint: t('admin:withdrawals.hashHint') });
          const demoFill = config.demoTools ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: () => { hash.control.value = demoTxHash(); } } }, t('admin:demo.fillHash')) : null;
          actions.push(h('div', { class: 'stack stack--sm w-full' }, hash.el, h('div', { class: 'cluster' }, demoFill,
            actionButton(t('admin:withdrawals.recordBroadcast'), { confirm: t('admin:withdrawals.broadcastText'), run: () => adminApi.withdrawalAction(id, 'broadcast', { txHash: hash.control.value.trim() }), onDone: after }))));
        }
        if (w.status === 'processing' && w.txHash && can('withdrawals.process')) {
          const fee = formField({ label: t('admin:withdrawals.actualFee'), control: input({ inputmode: 'decimal', dir: 'ltr' }), hint: t('admin:withdrawals.actualFeeHint'), id: 'wd-fee' });
          actions.push(h('div', { class: 'stack stack--sm w-full' }, fee.el,
            actionButton(t('admin:withdrawals.complete'), { tone: 'primary', confirm: t('admin:withdrawals.completeText'), run: () => adminApi.withdrawalAction(id, 'complete', fee.control.value.trim() ? { actualNetworkFee: fee.control.value.trim() } : {}), onDone: after })));
          if (config.demoTools && can('demo.tools')) actions.push(actionButton(t('admin:demo.confirmOnChain'), { run: () => adminApi.confirmWithdrawal({ withdrawalId: id }), onDone: after }));
        }
        if (w.status === 'processing' && can('withdrawals.process')) {
          const sure = checkbox({ label: t('admin:withdrawals.fundsNotSent'), name: 'fundsNotSent' });
          actions.push(h('div', { class: 'stack stack--sm w-full' }, sure.el,
            actionButton(t('admin:withdrawals.fail'), { tone: 'danger', reason: t('admin:withdrawals.failText'), run: (reason) => {
              if (!sure.input.checked) throw Object.assign(new Error('must_confirm'), { code: 'confirm_funds_not_sent' });
              return adminApi.withdrawalAction(id, 'fail', { reason, fundsNotSent: true });
            }, onDone: after })));
        }
        const row = (label, v, cls = '') => h('div', { class: `fee-summary__row ${cls}`.trim() }, h('span', {}, label), h('span', { class: 'num' }, v));
        replace(body,
          w.openRiskFlags.length ? alertBox({ tone: 'danger', title: t('admin:withdrawals.flagsTitle'), text: w.openRiskFlags.map((f) => t(`admin:flags.types.${f.flagType}`)).join(', ') }) : null,
          w.userStatus !== 'active' ? alertBox({ tone: 'warning', text: t('admin:withdrawals.userNotActive', { status: t(`common:status.${w.userStatus}`) }) }) : null,
          h('div', { class: 'grid grid--2' },
            h('dl', { class: 'kv' },
              h('dt', {}, t('admin:reference')), h('dd', {}, h('bdi', { class: 'mono', dir: 'ltr' }, w.reference)),
              h('dt', {}, t('admin:users.status')), h('dd', {}, statusBadge(w.status), w.statusReason ? h('span', { class: 'text-xs text-subtle' }, ` ${w.statusReason === 'awaiting_second_approval' ? t('admin:withdrawals.awaitingSecond') : w.statusReason}`) : null),
              h('dt', {}, t('admin:users.email')), h('dd', {}, userLink(w.userId, w.email)),
              h('dt', {}, t('admin:users.kyc')), h('dd', {}, t(`admin:kyc.${w.kycStatus}`)),
              h('dt', {}, t('admin:withdrawals.accountAge')), h('dd', {}, formatRelative(w.userCreatedAt)),
              h('dt', {}, t('admin:withdrawals.previous')), h('dd', {}, String(w.completedWithdrawals)),
              h('dt', {}, t('admin:withdrawals.wallet')), h('dd', {}, `${w.walletLabel} · ${t('admin:withdrawals.walletAge', { time: formatRelative(w.walletConfirmedAt || w.walletCreatedAt) })}`),
              h('dt', {}, t('admin:withdrawals.dual')), h('dd', {}, w.requiresDualApproval ? t('admin:yes') : t('admin:no')),
              w.approvedByEmail ? [h('dt', {}, t('admin:withdrawals.approvedBy')), h('dd', {}, w.approvedByEmail)] : null,
              w.secondApprovedByEmail ? [h('dt', {}, t('admin:withdrawals.secondBy')), h('dd', {}, w.secondApprovedByEmail)] : null,
              w.processedByEmail ? [h('dt', {}, t('admin:withdrawals.processedBy')), h('dd', {}, w.processedByEmail)] : null,
              h('dt', {}, t('admin:date')), h('dd', {}, formatDateTime(w.createdAt))),
            h('div', { class: 'stack stack--sm' },
              h('span', { class: 'field__label' }, `${w.assetCode} · ${w.networkCode}`),
              addressBox(w.address),
              w.addressUrl ? h('a', { href: w.addressUrl, target: '_blank', rel: 'noopener noreferrer', class: 'text-small' }, t('admin:withdrawals.viewAddress')) : null,
              w.memo ? h('span', { class: 'text-small' }, `${t('deposit:memo')}: ${w.memo}`) : null,
              h('div', { class: 'fee-summary' },
                row(t('withdrawal:amount'), formatAmount(w.amount, w.assetCode)),
                row(t('withdrawal:platformFeePlain'), `− ${formatAmount(w.platformFee, w.assetCode)}`),
                row(t('withdrawal:networkFee'), `− ${formatAmount(w.networkFee, w.assetCode)}`),
                row(t('admin:withdrawals.send'), formatAmount(w.netAmount, w.assetCode), 'fee-summary__row--total')),
              w.txHash ? h('p', { class: 'text-small' }, t('transactions:txHash'), ' ', inlineHash(w.txHash, { href: w.explorerUrl })) : null)),
          actions.length ? section(t('admin:actions'), h('div', { class: 'cluster' }, actions)) : null);
      }).catch((err) => replace(body, errorState(err)));
    }

    const list = dataTable({
      columns: [
        { key: 'ref', label: t('admin:reference'), primary: true, render: (w) => h('bdi', { class: 'mono', dir: 'ltr' }, w.reference) },
        { key: 'user', label: t('admin:users.email'), render: (w) => userLink(w.userId, w.email) },
        { key: 'amount', label: t('withdrawal:amount'), align: 'end', render: (w) => formatAmount(w.amount, w.assetCode) },
        { key: 'net', label: t('admin:withdrawals.send'), align: 'end', render: (w) => formatAmount(w.netAmount, w.assetCode) },
        { key: 'status', label: t('admin:users.status'), render: (w) => h('span', { class: 'stack stack--sm' }, statusBadge(w.status), w.statusReason === 'awaiting_second_approval' ? h('span', { class: 'text-xs text-subtle' }, t('admin:withdrawals.awaitingSecond')) : null) },
        { key: 'dual', label: t('admin:withdrawals.dual'), render: (w) => (w.requiresDualApproval ? t('admin:yes') : '') },
        { key: 'date', label: t('admin:date'), render: (w) => formatDateTime(w.createdAt) },
      ],
      onRowClick: (w) => openDetail(w.id),
      empty: emptyState({ iconName: 'withdraw', title: t('admin:withdrawals.none') }),
    });
    const more = loadMore({ onLoad: async (cursor) => { const r = await adminApi.withdrawals({ ...filters, cursor }); list.update(r.items, { append: true }); more.setCursor(r.nextCursor); } });
    async function load() {
      const r = await adminApi.withdrawals(filters);
      list.update(r.items);
      more.setCursor(r.nextCursor);
    }
    const bar = filterBar({
      fields: [
        { name: 'search', type: 'search', label: t('admin:search'), placeholder: t('admin:withdrawals.searchHint') },
        { name: 'status', type: 'select', label: t('admin:users.status'), options: STATUSES.map((s) => ({ value: s, label: t(`common:status.${s}`) })) },
      ],
      onChange: (v) => { filters = v; load(); },
    });
    filters = bar.values();
    replace(page, pageHeader({ title: t('admin:withdrawals.title'), subtitle: t('admin:withdrawals.subtitle') }),
      alertBox({ tone: 'info', text: t('admin:withdrawals.rules') }), bar.el, list.el, more.el);
    await load();
    liveRefresh(['withdrawal.updated', 'withdrawal.reorg', 'withdrawal.amount_mismatch'], () => load().catch(() => {}));
  },
});
