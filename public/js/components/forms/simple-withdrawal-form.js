// Withdrawal in one card: network, the user's own address, amount -> the
// server's quote (3% platform fee + network fee, what arrives) -> confirm.
// The request then waits for staff, who pay it out and record the payout.
// Every figure shown comes from the quote; confirming sends the quote id with
// an idempotency key, so a double click creates at most one request.
import { withdrawalsApi } from '../../api/endpoints.js';
import { h, icon, replace } from '../../core/dom.js';
import { formatAmount, isZero } from '../../formatting/format-currency.js';
import { formatCountdown } from '../../formatting/format-date.js';
import { formatPercent } from '../../formatting/format-number.js';
import { t } from '../../i18n/i18n.js';
import { createActionKey } from '../../services/idempotency.js';
import { validateAmount } from '../../validation/validate-amount.js';
import { alertBox } from '../feedback/alert.js';
import { errorMessage, fieldErrorMessage } from '../feedback/error-message.js';
import { addressBox } from '../misc/address-display.js';
import { withMfa } from '../modals/mfa-dialog.js';
import { toast } from '../notifications/toast.js';
import { amountInput } from './amount-input.js';
import { formField, input } from './form-field.js';
import { setBusy, showServerErrors } from './form-validation.js';

// "BEP20 (BNB Smart Chain)" -> "BEP20" for labels that already sit next to the full name.
const shortNetwork = (name) => String(name || '').replace(/\s*\(.*\)\s*$/, '');

const AMOUNT_ERRORS = ['amount_below_minimum', 'insufficient_withdrawable_balance', 'amount_below_fees', 'amount_precision', 'daily_limit_exceeded'];

export function simpleWithdrawalForm({ routes, balances, needsMfa, onCreated }) {
  const root = h('div', { class: 'stack withdrawal-form' });
  const actionKey = createActionKey();
  let route = routes[0];
  let timer = null;
  let draft = { address: '', amount: '' };

  const withdrawable = () => balances.find((b) => b.asset === route.asset)?.withdrawable ?? '0';

  function details() {
    clearInterval(timer);
    const chips = routes.length > 1
      ? h('div', { class: 'method-picker__list', role: 'radiogroup', 'aria-label': t('common:fields.network') }, routes.map((r) => {
          const radio = h('input', { type: 'radio', name: 'wd-route', class: 'method-chip__input', checked: r === route });
          radio.addEventListener('change', () => { route = r; details(); });
          return h('label', { class: 'method-chip' }, radio, h('span', { class: 'method-chip__body' }, h('strong', {}, r.asset), h('span', { class: 'method-chip__net' }, r.networkName)));
        }))
      : h('div', { class: 'deposit-address__network' }, h('strong', {}, route.asset), h('span', {}, route.networkName));
    const addressCtl = input({ dir: 'ltr', class: 'input input--mono', autocomplete: 'off', spellcheck: false, maxlength: 128, placeholder: t('withdrawal:simple.addressPlaceholder'), value: draft.address });
    const address = formField({ label: t('withdrawal:simple.addressLabel', { asset: route.asset, network: shortNetwork(route.networkName) }), control: addressCtl, id: 'wd-address' });
    const amountCtl = amountInput({ asset: route.asset, max: () => withdrawable() });
    amountCtl.control.value = draft.amount;
    const amount = formField({ label: t('common:fields.amount'), control: amountCtl.control, body: amountCtl.el, aside: t('withdrawal:availableToWithdraw', { amount: formatAmount(withdrawable(), route.asset) }), id: 'wd-amount' });
    const next = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, t('withdrawal:simple.continue'));
    const form = h('form', { class: 'form', novalidate: true }, chips, address.el, amount.el,
      h('p', { class: 'text-xs text-subtle' }, t('withdrawal:simple.feeLine', { min: formatAmount(route.minWithdrawal, route.asset), fee: formatAmount(route.networkFee, route.asset) })),
      next);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      draft = { address: addressCtl.value.trim(), amount: amountCtl.value() };
      address.setError(draft.address ? '' : t('errors:validation.required'));
      const problem = validateAmount(draft.amount);
      amount.setError(problem ? fieldErrorMessage(problem) : '');
      if (!draft.address || problem) return;
      setBusy(next, true);
      try {
        const q = await withdrawalsApi.quote({ asset: route.asset, network: route.network, address: draft.address, amount: draft.amount });
        actionKey.reset();
        review(q);
      } catch (err) {
        if (AMOUNT_ERRORS.includes(err.code)) amount.setError(errorMessage(err));
        else showServerErrors(err, { address, amount, network: address });
      } finally {
        setBusy(next, false);
      }
    });
    replace(root, needsMfa ? alertBox({ tone: 'warning', title: t('withdrawal:simple.mfa'), action: h('a', { class: 'btn btn--sm', href: '/security' }, t('withdrawal:openSecurity')) }) : null, form);
  }

  function review(q) {
    const receivedAt = Date.now();
    const ttl = new Date(q.expiresAt).getTime() - new Date(q.createdAt).getTime();
    const countdown = h('span', { class: 'num' });
    const back = h('button', { class: 'btn', type: 'button' }, icon('arrow-left', { size: 'sm', className: 'icon--directional' }), t('common:actions.back'));
    const confirm = h('button', { class: 'btn btn--primary', type: 'button' }, t('withdrawal:confirm'));
    const error = h('div', { role: 'alert' });
    const row = (label, value, cls = '') => h('div', { class: `fee-summary__row ${cls}`.trim() }, h('span', {}, label), h('span', { class: 'num' }, value));

    replace(root,
      h('h3', { class: 'card__title' }, t('withdrawal:simple.reviewTitle')),
      addressBox(q.address),
      h('div', { class: 'fee-summary', 'aria-label': t('withdrawal:summary') },
        row(t('withdrawal:amount'), formatAmount(q.amount, q.assetCode)),
        row(t('withdrawal:platformFee', { rate: formatPercent(q.feeRate) }), `− ${formatAmount(q.platformFee, q.assetCode)}`),
        row(t('withdrawal:networkFee'), isZero(q.networkFee) ? t('withdrawal:none') : `− ${formatAmount(q.networkFee, q.assetCode)}`),
        row(t('withdrawal:youReceive'), formatAmount(q.netAmount, q.assetCode), 'fee-summary__row--total')),
      h('p', { class: 'text-xs text-subtle' }, t('withdrawal:simple.sentToStaff'), ' ', t('withdrawal:quoteValid'), ' ', countdown),
      error,
      h('div', { class: 'cluster' }, back, confirm));

    const tick = () => {
      const left = ttl - (Date.now() - receivedAt);
      if (left <= 0) {
        clearInterval(timer);
        countdown.textContent = t('withdrawal:quoteExpired');
        confirm.disabled = true;
        replace(error, alertBox({ tone: 'warning', text: t('withdrawal:quoteExpiredText'), action: h('button', { class: 'btn btn--sm', type: 'button', on: { click: details } }, t('withdrawal:newQuote')) }));
        return;
      }
      countdown.textContent = formatCountdown(left);
    };
    clearInterval(timer);
    tick();
    timer = setInterval(tick, 1000);

    back.addEventListener('click', details);
    confirm.addEventListener('click', async () => {
      setBusy(confirm, true);
      replace(error);
      try {
        const created = await withMfa(() => withdrawalsApi.create(q.id, actionKey.get()));
        clearInterval(timer);
        draft = { address: '', amount: '' };
        const another = h('button', { class: 'btn', type: 'button', on: { click: () => { actionKey.reset(); details(); } } }, t('withdrawal:another'));
        replace(root, alertBox({ tone: 'success', title: t('withdrawal:createdTitle'), text: t('withdrawal:simple.requested', { reference: created.reference, amount: formatAmount(created.netAmount, created.assetCode) }) }), h('div', {}, another));
        onCreated?.(created);
      } catch (err) {
        if (err.code === 'quote_expired' || err.code === 'quote_already_used') {
          details();
          toast(errorMessage(err), { tone: 'warning' });
          return;
        }
        replace(error, alertBox({ tone: 'danger', text: errorMessage(err),
          action: err.code === 'mfa_setup_required' ? h('a', { class: 'btn btn--sm', href: '/security' }, t('withdrawal:openSecurity')) : null }));
      } finally {
        setBusy(confirm, false);
      }
    });
    confirm.focus();
  }

  details();
  return {
    el: root,
    update(next) {
      if (next.balances) balances = next.balances;
    },
    destroy: () => clearInterval(timer),
  };
}
