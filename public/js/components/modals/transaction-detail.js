// One ledger transaction with the debit/credit entries it posted to the
// user's own accounts — the proof behind every line in the history.
import { transactionsApi } from '../../api/endpoints.js';
import { h, replace } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { errorState } from '../feedback/error-state.js';
import { skeletonRows } from '../feedback/skeleton.js';
import { statusBadge } from '../feedback/status-badge.js';
import { inlineHash } from '../misc/address-display.js';
import { amount } from '../misc/amount-display.js';
import { openModal } from './modal.js';

export function openTransactionDetail(row) {
  const content = h('div', { class: 'stack' }, skeletonRows(3));
  openModal({ title: t(`transactions:types.${row.type}`), body: content, wide: true });

  const summary = h('dl', { class: 'kv' },
    h('dt', {}, t('transactions:amount')), h('dd', {}, amount(row.amount, row.asset, { sign: true })),
    h('dt', {}, t('transactions:status')), h('dd', {}, statusBadge(row.status)),
    h('dt', {}, t('transactions:date')), h('dd', {}, formatDateTime(row.postedAt)),
    row.reference ? [h('dt', {}, t('transactions:reference')), h('dd', {}, h('bdi', { class: 'mono', dir: 'ltr' }, row.reference))] : null,
    row.txHash ? [h('dt', {}, t('transactions:txHash')), h('dd', {}, inlineHash(row.txHash))] : null,
  );
  const note = row.informational ? h('p', { class: 'text-small text-muted' }, t('transactions:feeIncluded')) : null;

  transactionsApi.get(row.ledgerTransactionId)
    .then((tx) => {
      const entries = h('table', { class: 'ledger-entries' },
        h('caption', { class: 'visually-hidden' }, t('transactions:entriesTitle')),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'text-start' }, t('transactions:account')), h('th', { scope: 'col', class: 'dr' }, t('transactions:debit')), h('th', { scope: 'col', class: 'cr' }, t('transactions:credit')))),
        h('tbody', {}, tx.entries.map((e) => h('tr', {},
          h('td', {}, t(`transactions:accounts.${e.accountType}`)),
          h('td', { class: 'dr' }, e.direction === 'debit' ? h('bdi', { dir: 'ltr' }, formatAmount(e.amount, tx.assetCode, { withAsset: false })) : ''),
          h('td', { class: 'cr' }, e.direction === 'credit' ? h('bdi', { dir: 'ltr' }, formatAmount(e.amount, tx.assetCode, { withAsset: false })) : '')))));
      replace(content,
        summary,
        note,
        h('section', { class: 'stack stack--sm' },
          h('h3', { class: 'section-title' }, t('transactions:entriesTitle')),
          h('p', { class: 'text-xs text-subtle' }, t('transactions:entriesHint')),
          entries,
          h('p', { class: 'text-xs text-subtle' }, t('transactions:ledgerId'), ' ', h('bdi', { class: 'mono', dir: 'ltr' }, tx.id))));
    })
    .catch((err) => replace(content, summary, errorState(err)));
}
