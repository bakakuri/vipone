// Deposit detail: amounts, network, transaction hash (explorer link) and the
// lifecycle from detection to credit.
import { depositsApi } from '../../api/endpoints.js';
import { h, replace } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { has, t } from '../../i18n/i18n.js';
import { errorState } from '../feedback/error-state.js';
import { skeletonRows } from '../feedback/skeleton.js';
import { statusBadge } from '../feedback/status-badge.js';
import { confirmationProgress } from '../finance/confirmation-progress.js';
import { statusTimeline } from '../finance/status-timeline.js';
import { inlineHash } from '../misc/address-display.js';
import { openModal } from './modal.js';

// Known machine reasons are translated; a reason written by staff is shown as is.
export function reasonText(reason, ns = 'deposit') {
  if (!reason) return null;
  return has(`${ns}:reasons.${reason}`) ? t(`${ns}:reasons.${reason}`) : reason;
}

const ORDER = ['awaiting_payment', 'detected', 'confirming', 'confirmed', 'credited'];

export function openDepositDetail(id) {
  const body = h('div', { class: 'stack' }, skeletonRows(4));
  openModal({ title: t('deposit:detailTitle'), body, wide: true });
  depositsApi.get(id).then((d) => {
    const reached = ORDER.indexOf(d.status === 'under_review' ? 'confirmed' : d.status);
    const failed = ['failed', 'rejected'].includes(d.status);
    const manual = d.source === 'manual';
    const steps = manual ? [
      { label: t('deposit:manualTimeline.reported'), at: d.createdAt, done: true },
      { label: t('deposit:manualTimeline.checking'), note: d.status === 'under_review' ? t('deposit:manual.checkingNote') : null, at: d.reviewedAt, done: ['confirmed', 'credited'].includes(d.status) },
      { label: t('deposit:timeline.credited'), at: d.creditedAt, done: d.status === 'credited' },
    ] : [
      { key: 'detected', at: d.detectedAt },
      { key: 'confirming', note: d.requiredConfirmations ? t('deposit:confirmationsShort', { done: Math.min(d.confirmations, d.requiredConfirmations), required: d.requiredConfirmations }) : null },
      { key: 'confirmed', at: d.confirmedAt },
      { key: 'credited', at: d.creditedAt },
    ].map((s) => ({ label: t(`deposit:timeline.${s.key}`), at: s.at, note: s.note, done: reached >= ORDER.indexOf(s.key) }));
    if (!manual && d.status === 'under_review') steps.splice(3, 0, { label: t('deposit:timeline.review'), note: t('deposit:reviewNote') });
    if (failed) steps.push({ label: t(`common:status.${d.status}`), failed: true, note: reasonText(d.statusReason) });

    replace(body,
      h('dl', { class: 'kv' },
        h('dt', {}, t('deposit:reference')), h('dd', {}, h('bdi', { class: 'mono', dir: 'ltr' }, d.reference)),
        h('dt', {}, t('transactions:status')), h('dd', {}, statusBadge(d.status)),
        h('dt', {}, t('common:fields.amount')), h('dd', { class: 'num' }, d.amount ? formatAmount(d.amount, d.assetCode) : t('deposit:notReceivedYet')),
        d.expectedAmount ? [h('dt', {}, t('deposit:expectedAmount')), h('dd', { class: 'num' }, formatAmount(d.expectedAmount, d.assetCode))] : null,
        manual && d.claimedAmount && d.claimedAmount !== d.amount ? [h('dt', {}, t('deposit:manual.amountReported')), h('dd', { class: 'num' }, formatAmount(d.claimedAmount, d.assetCode))] : null,
        manual && d.userNote ? [h('dt', {}, t('deposit:manual.note')), h('dd', {}, d.userNote)] : null,
        h('dt', {}, t('common:fields.network')), h('dd', {}, `${d.assetCode} · ${d.networkCode}`),
        ['detected', 'confirming'].includes(d.status) ? [h('dt', {}, t('deposit:confirmationsLabel')), h('dd', {}, confirmationProgress(d.confirmations, d.requiredConfirmations))] : null,
        h('dt', {}, t('transactions:txHash')), h('dd', {}, inlineHash(d.txHash, { href: d.explorerUrl })),
        h('dt', {}, t('transactions:date')), h('dd', {}, formatDateTime(d.createdAt))),
      statusTimeline(steps));
  }).catch((err) => replace(body, errorState(err)));
}
