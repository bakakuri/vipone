// Withdrawal in three steps: choose a confirmed address and amount -> review
// the server's quote (3% platform fee + network fee, what arrives) -> confirm.
// The browser never computes the fee it shows: every figure comes from the
// quote. Confirming sends the quote id with an idempotency key, so a double
// click or a retried request creates at most one withdrawal.
import { withdrawalsApi } from '../../api/endpoints.js';
import { h, icon, replace } from '../../core/dom.js';
import { formatAmount, isZero } from '../../formatting/format-currency.js';
import { formatCountdown, formatDateTime } from '../../formatting/format-date.js';
import { formatPercent } from '../../formatting/format-number.js';
import { t } from '../../i18n/i18n.js';
import { createActionKey } from '../../services/idempotency.js';
import { compareDecimal } from '../../validation/compare-decimal.js';
import { validateAmount } from '../../validation/validate-amount.js';
import { alertBox } from '../feedback/alert.js';
import { errorMessage, fieldErrorMessage } from '../feedback/error-message.js';
import { addressBox } from '../misc/address-display.js';
import { withMfa } from '../modals/mfa-dialog.js';
import { toast } from '../notifications/toast.js';
import { amountInput } from './amount-input.js';
import { formField, select } from './form-field.js';
import { setBusy, showServerErrors } from './form-validation.js';

const usable = (w) => w.status === 'active' && (!w.usableFrom || new Date(w.usableFrom) <= new Date());

export function withdrawalForm({ wallets, balances, mfaEnabled, onCreated }) {
  const root = h('div', { class: 'withdrawal-form' });
  const actionKey = createActionKey();
  let quote = null;
  let timer = null;

  const steps = h('ol', { class: 'steps', 'aria-label': t('withdrawal:steps.label') },
    ['details', 'review', 'done'].map((s) => h('li', { class: 'steps__item', dataset: { step: s } }, t(`withdrawal:steps.${s}`))));
  const body = h('div', { class: 'stack' });
  root.append(steps, body);

  function markStep(current) {
    const order = ['details', 'review', 'done'];
    steps.querySelectorAll('.steps__item').forEach((li) => {
      const i = order.indexOf(li.dataset.step);
      const c = order.indexOf(current);
      li.classList.toggle('is-done', i < c);
      li.classList.toggle('is-current', i === c);
      if (i === c) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
  }

  const withdrawableFor = (asset) => balances.find((b) => b.asset === asset)?.withdrawable ?? '0';

  function detailsStep(prefill = {}) {
    markStep('details');
    clearInterval(timer);
    const active = wallets.filter((w) => w.status === 'active');
    if (!active.length) {
      replace(body, alertBox({
        tone: 'info',
        title: t('withdrawal:noWalletTitle'),
        text: t('withdrawal:noWalletText'),
        action: h('a', { class: 'btn btn--sm btn--primary', href: '/wallets' }, icon('plus', { size: 'sm' }), t('withdrawal:addWallet')),
      }));
      return;
    }
    const walletSelect = select(active.map((w) => ({
      value: w.id,
      label: `${w.label} · ${w.assetCode} · ${w.networkCode}${usable(w) ? '' : ` (${t('withdrawal:coolingDown')})`}`,
    })), { name: 'walletId', value: prefill.walletId || active.find((w) => w.isDefault)?.id });
    const walletField = formField({ label: t('withdrawal:destination'), control: walletSelect, id: 'wd-wallet' });
    const walletInfo = h('div', { class: 'stack stack--sm' });
    const amountCtl = amountInput({ max: () => withdrawableFor(selectedWallet().assetCode) });
    const amountField = formField({ label: t('common:fields.amount'), control: amountCtl.control, body: amountCtl.el, id: 'wd-amount' });
    const available = h('div', { class: 'field__hint' });
    const review = h('button', { class: 'btn btn--primary', type: 'submit' }, t('withdrawal:review'));
    const form = h('form', { class: 'form', novalidate: true }, walletField.el, walletInfo, amountField.el, available,
      mfaEnabled ? null : alertBox({ tone: 'warning', title: t('withdrawal:mfaNeededTitle'), text: t('withdrawal:mfaNeededText'), action: h('a', { class: 'btn btn--sm', href: '/security' }, t('withdrawal:openSecurity')) }),
      h('div', { class: 'cluster' }, review));

    function selectedWallet() {
      return active.find((w) => w.id === walletSelect.value) || active[0];
    }
    function refreshWallet() {
      const w = selectedWallet();
      amountCtl.setAsset(w.assetCode);
      available.textContent = t('withdrawal:availableToWithdraw', { amount: formatAmount(withdrawableFor(w.assetCode), w.assetCode) });
      replace(walletInfo,
        addressBox(w.address),
        w.memo ? h('div', { class: 'text-small' }, t('withdrawal:memoLine', { memo: w.memo })) : null,
        usable(w) ? null : alertBox({ tone: 'info', text: t('withdrawal:coolingDownText', { date: formatDateTime(w.usableFrom) }) }));
    }
    walletSelect.addEventListener('change', refreshWallet);
    refreshWallet();
    if (prefill.amount) amountCtl.control.value = prefill.amount;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fields = { walletId: walletField, amount: amountField };
      const value = amountCtl.value();
      const problem = validateAmount(value);
      amountField.setError(problem ? fieldErrorMessage(problem) : '');
      if (problem) {
        amountCtl.control.focus();
        return;
      }
      setBusy(review, true);
      try {
        const q = await withdrawalsApi.quote({ walletId: walletSelect.value, amount: value });
        actionKey.reset();
        reviewStep(q, { walletId: walletSelect.value, amount: value });
      } catch (err) {
        if (['amount_below_minimum', 'insufficient_withdrawable_balance', 'amount_below_fees', 'amount_precision', 'daily_limit_exceeded'].includes(err.code)) amountField.setError(errorMessage(err));
        else showServerErrors(err, fields);
      } finally {
        setBusy(review, false);
      }
    });
    replace(body, form);
  }

  function reviewStep(q, prefill) {
    quote = q;
    markStep('review');
    const receivedAt = Date.now();
    const ttl = new Date(q.expiresAt).getTime() - new Date(q.createdAt).getTime();
    const countdown = h('span', { class: 'num' });
    const back = h('button', { class: 'btn', type: 'button' }, icon('arrow-left', { size: 'sm', className: 'icon--directional' }), t('common:actions.back'));
    const confirm = h('button', { class: 'btn btn--primary', type: 'button' }, t('withdrawal:confirm'));
    const error = h('div', { role: 'alert' });
    const insufficient = compareDecimal(q.withdrawable, q.amount) < 0;

    const row = (label, value, cls = '') => h('div', { class: `fee-summary__row ${cls}`.trim() }, h('span', {}, label), h('span', { class: 'num' }, value));
    const summary = h('div', { class: 'fee-summary', 'aria-label': t('withdrawal:summary') },
      row(t('withdrawal:amount'), formatAmount(q.amount, q.assetCode)),
      row(t('withdrawal:platformFee', { rate: formatPercent(q.feeRate) }), `− ${formatAmount(q.platformFee, q.assetCode)}`),
      row(t('withdrawal:networkFee'), isZero(q.networkFee) ? t('withdrawal:none') : `− ${formatAmount(q.networkFee, q.assetCode)}`),
      row(t('withdrawal:youReceive'), formatAmount(q.netAmount, q.assetCode), 'fee-summary__row--total'));

    replace(body,
      h('div', { class: 'stack' },
        h('div', { class: 'stack stack--sm' }, h('div', { class: 'field__label' }, t('withdrawal:sendingTo', { label: q.walletLabel, network: q.networkCode })), addressBox(q.address),
          q.memo ? h('div', { class: 'text-small' }, t('withdrawal:memoLine', { memo: q.memo })) : null),
        summary,
        h('p', { class: 'text-xs text-subtle' }, t('withdrawal:feeExplained')),
        insufficient ? alertBox({ tone: 'danger', text: t('errors:codes.insufficient_withdrawable_balance') }) : null,
        alertBox({ tone: 'info', text: t('withdrawal:processingNote') }),
        h('p', { class: 'text-small text-muted' }, t('withdrawal:quoteValid'), ' ', countdown),
        error,
        h('div', { class: 'cluster' }, back, confirm)));

    const tick = () => {
      const left = ttl - (Date.now() - receivedAt);
      if (left <= 0) {
        clearInterval(timer);
        countdown.textContent = t('withdrawal:quoteExpired');
        confirm.disabled = true;
        replace(error, alertBox({ tone: 'warning', text: t('withdrawal:quoteExpiredText'), action: h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => detailsStep(prefill) } }, t('withdrawal:newQuote')) }));
        return;
      }
      countdown.textContent = formatCountdown(left);
    };
    clearInterval(timer);
    tick();
    timer = setInterval(tick, 1000);

    back.addEventListener('click', () => detailsStep(prefill));
    confirm.addEventListener('click', async () => {
      setBusy(confirm, true);
      replace(error);
      try {
        const created = await withMfa(() => withdrawalsApi.create(quote.id, actionKey.get()));
        clearInterval(timer);
        doneStep(created);
        onCreated?.(created);
      } catch (err) {
        if (err.code === 'quote_expired' || err.code === 'quote_already_used') {
          detailsStep(prefill);
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

  function doneStep(w) {
    markStep('done');
    const another = h('button', { class: 'btn', type: 'button' }, t('withdrawal:another'));
    another.addEventListener('click', () => {
      actionKey.reset();
      detailsStep();
    });
    replace(body, h('div', { class: 'stack', role: 'status' },
      alertBox({ tone: 'success', title: t('withdrawal:createdTitle'), text: t('withdrawal:createdText', { reference: w.reference, amount: formatAmount(w.netAmount, w.assetCode) }) }),
      h('div', { class: 'cluster' }, another)));
  }

  detailsStep();
  return {
    el: root,
    update(next) {
      if (next.wallets) wallets = next.wallets;
      if (next.balances) balances = next.balances;
    },
    destroy: () => clearInterval(timer),
  };
}
