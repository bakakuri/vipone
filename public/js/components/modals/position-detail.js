// Position detail: frozen terms (the version the user accepted), every event
// with its ledger amounts, and the current value from posted results.
import { investmentsApi } from '../../api/endpoints.js';
import { h, replace } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDate, formatDateTime } from '../../formatting/format-date.js';
import { formatPercent } from '../../formatting/format-number.js';
import { localized, t } from '../../i18n/i18n.js';
import { errorState } from '../feedback/error-state.js';
import { skeletonRows } from '../feedback/skeleton.js';
import { statusBadge } from '../feedback/status-badge.js';
import { amount } from '../misc/amount-display.js';
import { openModal } from './modal.js';

export function openPositionDetail(id) {
  const body = h('div', { class: 'stack' }, skeletonRows(5));
  openModal({ title: t('investments:detail.title'), body, wide: true });
  investmentsApi.position(id).then((p) => {
    const terms = p.terms || {};
    const events = h('ol', { class: 'timeline' }, p.events.map((e) => h('li', { class: 'timeline__item is-done' },
      h('span', { class: 'timeline__dot', 'aria-hidden': 'true' }),
      h('div', {},
        h('div', { class: 'timeline__title' }, t(`investments:events.${e.eventType}`),
          e.netAmount ? h('span', {}, ' ', amount(e.netAmount, p.assetCode, { sign: e.eventType === 'result' })) : null),
        e.eventType === 'result'
          ? h('div', { class: 'timeline__meta' }, t('investments:detail.resultLine', {
              start: formatDate(e.periodStart), end: formatDate(e.periodEnd), rate: formatPercent(e.grossReturnRate, { signDisplay: 'exceptZero' }),
              gross: formatAmount(e.grossAmount, p.assetCode), fee: formatAmount(e.feeAmount, p.assetCode),
            }))
          : null,
        h('div', { class: 'timeline__meta' }, formatDateTime(e.createdAt))))));
    replace(body,
      h('dl', { class: 'kv' },
        h('dt', {}, t('investments:detail.product')), h('dd', {}, localized(terms.name) || p.productName?.en || ''),
        h('dt', {}, t('investments:detail.reference')), h('dd', {}, h('bdi', { class: 'mono', dir: 'ltr' }, p.reference)),
        h('dt', {}, t('transactions:status')), h('dd', {}, statusBadge(p.status)),
        h('dt', {}, t('investments:position.principal')), h('dd', { class: 'num' }, formatAmount(p.principal, p.assetCode)),
        h('dt', {}, t('investments:position.value')), h('dd', { class: 'num' }, formatAmount(p.currentValue, p.assetCode)),
        h('dt', {}, t('investments:detail.started')), h('dd', {}, formatDateTime(p.startedAt)),
        h('dt', {}, t('investments:detail.maturity')), h('dd', {}, formatDateTime(p.maturityAt)),
        p.closedAt ? [h('dt', {}, t('investments:detail.closed')), h('dd', {}, formatDateTime(p.closedAt))] : null),
      h('section', { class: 'stack stack--sm' },
        h('h3', { class: 'section-title' }, t('investments:detail.terms', { version: p.productVersion })),
        h('dl', { class: 'kv' },
          h('dt', {}, t('investments:product.term')), h('dd', {}, t('investments:product.termDays', { count: terms.termDays })),
          h('dt', {}, t('investments:product.performanceFee')), h('dd', {}, formatPercent(terms.performanceFeeRate)),
          h('dt', {}, t('investments:product.earlyExit')), h('dd', {}, terms.earlyExitAllowed ? t('investments:product.earlyExitFee', { rate: formatPercent(terms.earlyExitFeeRate) }) : t('investments:product.earlyExitNo')),
          h('dt', {}, t('investments:product.risk')), h('dd', {}, t(`investments:risk.${terms.riskLevel}`)))),
      h('section', { class: 'stack stack--sm' }, h('h3', { class: 'section-title' }, t('investments:detail.events')), events),
      h('p', { class: 'text-xs text-subtle' }, t('investments:detail.note')));
  }).catch((err) => replace(body, errorState(err)));
}
