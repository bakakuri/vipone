// One investment position: principal, realised result so far, current value
// (principal + posted results, from the ledger), and the term's progress.
// Progress reflects elapsed time only; it never implies accrued profit.
import { h } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDate, formatDuration } from '../../formatting/format-date.js';
import { localized, t } from '../../i18n/i18n.js';
import { progressBar } from '../feedback/progress-bar.js';
import { statusBadge } from '../feedback/status-badge.js';
import { amount } from '../misc/amount-display.js';

export function positionCard(p, { onOpen, onClose } = {}) {
  const period = p.period || {};
  const name = typeof p.productName === 'object' ? localized(p.productName) : p.productName;
  const progressMeta = period.matured
    ? [h('span', {}, t('investments:position.matured')), h('span', {}, formatDate(p.maturityAt))]
    : [h('span', {}, t('investments:position.dayOf', { day: Math.min(period.elapsedDays + 1, period.termDays), total: period.termDays })),
       h('span', {}, t('investments:position.remaining', { time: formatDuration(period.remainingMs) }))];
  const isOpen = ['active', 'awaiting_settlement'].includes(p.status);
  const actions = [];
  if (onOpen) actions.push(h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => onOpen(p) } }, t('investments:position.details')));
  if (onClose && p.status === 'active' && p.earlyExitAllowed) actions.push(h('button', { class: 'btn btn--sm btn--ghost', type: 'button', on: { click: () => onClose(p) } }, t('investments:position.closeEarly')));

  return h('article', { class: 'card position-card', dataset: { id: p.id }, 'aria-labelledby': `pos-${p.id}` },
    h('div', { class: 'card__header' },
      h('div', { class: 'stack stack--sm' },
        h('h3', { class: 'card__title', id: `pos-${p.id}` }, name),
        h('span', { class: 'text-xs text-subtle' }, h('bdi', { class: 'mono', dir: 'ltr' }, p.reference))),
      statusBadge(p.status)),
    h('dl', { class: 'position-card__figures' },
      h('div', {}, h('dt', {}, t('investments:position.principal')), h('dd', { class: 'num' }, formatAmount(p.principal, p.assetCode))),
      h('div', {}, h('dt', {}, t('investments:position.realised')), h('dd', {}, p.realisedResult !== undefined ? amount(p.realisedResult, p.assetCode, { sign: true }) : '—')),
      h('div', {}, h('dt', {}, isOpen ? t('investments:position.value') : t('investments:position.released')),
        h('dd', { class: 'num' }, formatAmount(isOpen ? p.currentValue : p.releasedAmount, p.assetCode)))),
    isOpen ? progressBar(period.progress ?? 0, { label: t('investments:position.progress'), meta: progressMeta }) : null,
    p.status === 'awaiting_settlement' ? h('p', { class: 'text-small text-muted' }, t('investments:position.awaitingSettlement')) : null,
    h('p', { class: 'text-xs text-subtle' }, p.lastResultAt ? t('investments:position.resultsThrough', { date: formatDate(p.lastResultAt) }) : t('investments:position.noResultsYet')),
    actions.length ? h('div', { class: 'cluster' }, actions) : null);
}
