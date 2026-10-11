// "What if" arithmetic for a product's terms. The user types the period
// return they want to test (it can be negative); the calculator applies the
// product's real fee rules and dates. It is labelled as arithmetic, never as
// a forecast, and it never fills in a return rate by itself.
import { calculateScenario } from '../../calculations/investment-scenario.js';
import { h, replace } from '../../core/dom.js';
import { assetDecimals, formatAmount } from '../../formatting/format-currency.js';
import { formatDate } from '../../formatting/format-date.js';
import { formatPercent } from '../../formatting/format-number.js';
import { t } from '../../i18n/i18n.js';
import { normalizeAmountInput, validateAmount } from '../../validation/validate-amount.js';
import { amountInput } from '../forms/amount-input.js';
import { formField, input } from '../forms/form-field.js';

const RATE_RE = /^-?\d{1,3}(\.\d{1,4})?$/;

export function investmentCalculator(product, { asset = product.assets[0] } = {}) {
  const amountCtl = amountInput({ asset });
  amountCtl.control.value = product.minAmount;
  const amountField = formField({ label: t('investments:calc.amount'), control: amountCtl.control, body: amountCtl.el, id: `calc-amount-${product.id}` });
  const rate = input({ inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', placeholder: '0' });
  const rateField = formField({ label: t('investments:calc.rate'), control: rate, hint: t('investments:calc.rateHint'), id: `calc-rate-${product.id}`, body: h('div', { class: 'input-group' }, rate, h('div', { class: 'input-group__addon' }, h('span', { class: 'input-group__unit' }, '%'))) });
  const output = h('div', { class: 'fee-summary', 'aria-live': 'polite' });

  function render() {
    const value = normalizeAmountInput(amountCtl.control.value);
    const r = normalizeAmountInput(rate.value);
    amountField.setError('');
    rateField.setError('');
    if (validateAmount(value, { decimals: assetDecimals(asset) })) {
      replace(output, h('p', { class: 'text-small text-muted' }, t('investments:calc.enterAmount')));
      return;
    }
    if (r && !RATE_RE.test(r)) {
      rateField.setError(t('errors:validation.invalid'));
      return;
    }
    const s = calculateScenario({
      amount: value,
      ratePercent: r || '0',
      termDays: product.termDays,
      performanceFeeRate: product.performanceFeeRate,
      earlyExitFeeRate: product.earlyExitAllowed ? product.earlyExitFeeRate : 0,
      decimals: assetDecimals(asset),
    });
    const row = (label, v, cls = '') => h('div', { class: `fee-summary__row ${cls}`.trim() }, h('span', {}, label), h('span', { class: 'num' }, v));
    replace(output,
      row(t('investments:calc.maturityDate'), formatDate(s.maturity)),
      row(t('investments:calc.gross', { rate: r || '0' }), formatAmount(s.gross, asset, { sign: true })),
      row(t('investments:calc.fee', { rate: formatPercent(product.performanceFeeRate) }), formatAmount(s.fee, asset)),
      row(t('investments:calc.valueAtMaturity'), formatAmount(s.valueAtMaturity, asset), 'fee-summary__row--total'),
      product.earlyExitAllowed
        ? row(t('investments:calc.earlyExit', { rate: formatPercent(product.earlyExitFeeRate) }), formatAmount(s.earlyExitReceive, asset))
        : row(t('investments:calc.earlyExitNotAllowed'), '—'));
  }
  amountCtl.control.addEventListener('input', render);
  rate.addEventListener('input', render);
  render();

  return h('div', { class: 'calculator stack' },
    h('div', { class: 'form-row' }, amountField.el, rateField.el),
    output,
    h('p', { class: 'text-xs text-subtle' }, t('investments:calc.disclaimer')));
}
