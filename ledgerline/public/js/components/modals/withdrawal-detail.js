// Withdrawal detail: what was requested, the fees, what arrives, where it
// goes, and each step of processing.
import { withdrawalsApi } from '../../api/endpoints.js';
import { h, replace } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { errorState } from '../feedback/error-state.js';
import { skeletonRows } from '../feedback/skeleton.js';
import { statusBadge } from '../feedback/status-badge.js';
import { statusTimeline } from '../finance/status-timeline.js';
import { addressBox, inlineHash } from '../misc/address-display.js';
import { openModal } from './modal.js';
import { reasonText } from './deposit-detail.js';

const ORDER = ['pending', 'under_review', 'approved', 'processing', 'completed'];

export function openWithdrawalDetail(id) {
  const body = h('div', { class: 'stack' }, skeletonRows(4));
  openModal({ title: t('withdrawal:detailTitle'), body, wide: true });
  withdrawalsApi.get(id).then((w) => {
    const reached = ORDER.indexOf(w.status);
    const ended = ['rejected', 'failed', 'cancelled'].includes(w.status);
    const steps = [
      { key: 'created', at: w.createdAt, done: true },
      { key: 'review', done: reached >= 2 || w.status === 'completed' },
      { key: 'approved', at: w.approvedAt, done: reached >= 2 },
      { key: 'broadcast', at: w.broadcastAt, done: reached >= 3 },
      { key: 'completed', at: w.completedAt, done: reached >= 4 },
    ].map((s) => ({ label: t(`withdrawal:timeline.${s.key}`), at: s.at, done: s.done && !ended }));
    if (ended) steps.splice(1, steps.length, { label: t(`common:status.${w.status}`), failed: true, note: reasonText(w.statusReason, 'withdrawal'), at: w.updatedAt });
    const row = (label, value, cls = '') => h('div', { class: `fee-summary__row ${cls}`.trim() }, h('span', {}, label), h('span', { class: 'num' }, value));
    replace(body,
      h('dl', { class: 'kv' },
        h('dt', {}, t('withdrawal:reference')), h('dd', {}, h('bdi', { class: 'mono', dir: 'ltr' }, w.reference)),
        h('dt', {}, t('transactions:status')), h('dd', {}, statusBadge(w.status)),
        h('dt', {}, t('withdrawal:destination')), h('dd', {}, `${w.walletLabel} · ${w.assetCode} · ${w.networkCode}`)),
      addressBox(w.address),
      w.memo ? h('p', { class: 'text-small' }, t('withdrawal:memoLine', { memo: w.memo })) : null,
      h('div', { class: 'fee-summary' },
        row(t('withdrawal:amount'), formatAmount(w.amount, w.assetCode)),
        row(t('withdrawal:platformFeePlain'), `− ${formatAmount(w.platformFee, w.assetCode)}`),
        row(t('withdrawal:networkFee'), `− ${formatAmount(w.networkFee, w.assetCode)}`),
        row(t('withdrawal:youReceive'), formatAmount(w.netAmount, w.assetCode), 'fee-summary__row--total')),
      w.txHash ? h('p', { class: 'text-small' }, t('transactions:txHash'), ' ', inlineHash(w.txHash, { href: w.explorerUrl })) : null,
      statusTimeline(steps),
      w.requiresDualApproval && !ended && reached < 2 ? h('p', { class: 'text-xs text-subtle' }, t('withdrawal:dualApprovalNote')) : null,
      h('p', { class: 'text-xs text-subtle' }, t('withdrawal:requestedAt', { date: formatDateTime(w.createdAt) })));
  }).catch((err) => replace(body, errorState(err)));
}
