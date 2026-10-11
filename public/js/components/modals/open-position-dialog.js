// Opening a position: amount and asset, the frozen terms (version), the
// dates, and an explicit acknowledgement of risk. Funds move from available
// to invested in one database transaction; the idempotency key prevents a
// double submission from opening two positions.
import { investmentsApi } from '../../api/endpoints.js';
import { h } from '../../core/dom.js';
import { assetDecimals, formatAmount } from '../../formatting/format-currency.js';
import { formatDate } from '../../formatting/format-date.js';
import { formatPercent } from '../../formatting/format-number.js';
import { localized, t } from '../../i18n/i18n.js';
import { createActionKey } from '../../services/idempotency.js';
import { validateAmount } from '../../validation/validate-amount.js';
import { alertBox } from '../feedback/alert.js';
import { errorMessage, fieldErrorMessage } from '../feedback/error-message.js';
import { amountInput } from '../forms/amount-input.js';
import { checkbox, formField, select } from '../forms/form-field.js';
import { setBusy } from '../forms/form-validation.js';
import { toast } from '../notifications/toast.js';
import { openModal } from './modal.js';

export function openPositionDialog(product, { balances = [], onOpened } = {}) {
  const key = createActionKey();
  const availableFor = (asset) => balances.find((b) => b.asset === asset)?.available ?? '0';
  const assetSelect = select(product.assets.map((a) => ({ value: a, label: a })), { name: 'asset' });
  const assetField = formField({ label: t('common:fields.asset'), control: assetSelect, id: 'inv-asset' });
  const amountCtl = amountInput({ asset: product.assets[0], max: () => availableFor(assetSelect.value) });
  const amountField = formField({ label: t('common:fields.amount'), control: amountCtl.control, body: amountCtl.el, id: 'inv-amount' });
  const available = h('div', { class: 'field__hint' });
  const risk = checkbox({ label: t('investments:open.acceptRisk'), name: 'acceptRisk', required: true });
  const riskError = h('div', { class: 'field__error', role: 'alert' });
  const error = h('div');
  const maturity = new Date(Date.now() + product.termDays * 86400000);

  const syncAsset = () => {
    amountCtl.setAsset(assetSelect.value);
    available.textContent = t('investments:open.available', { amount: formatAmount(availableFor(assetSelect.value), assetSelect.value) });
  };
  assetSelect.addEventListener('change', syncAsset);
  syncAsset();

  const cancel = h('button', { class: 'btn', type: 'button' }, t('common:actions.cancel'));
  const submit = h('button', { class: 'btn btn--primary', type: 'button' }, t('investments:open.submit'));
  const modal = openModal({
    title: t('investments:open.title', { name: localized(product.name) }),
    body: [
      product.assets.length > 1 ? assetField.el : null,
      amountField.el,
      available,
      h('dl', { class: 'kv' },
        h('dt', {}, t('investments:product.term')), h('dd', {}, t('investments:product.termDays', { count: product.termDays })),
        h('dt', {}, t('investments:open.maturity')), h('dd', {}, t('investments:open.maturityApprox', { date: formatDate(maturity) })),
        h('dt', {}, t('investments:product.performanceFee')), h('dd', {}, formatPercent(product.performanceFeeRate)),
        h('dt', {}, t('investments:open.termsVersion')), h('dd', {}, `v${product.version}`)),
      alertBox({ tone: 'warning', text: t('investments:open.riskText') }),
      risk.el,
      riskError,
      error,
    ],
    footer: [cancel, submit],
  });
  cancel.addEventListener('click', () => modal.close());
  amountCtl.control.focus();

  submit.addEventListener('click', async () => {
    const value = amountCtl.value();
    const problem = validateAmount(value, { decimals: assetDecimals(assetSelect.value) });
    amountField.setError(problem ? fieldErrorMessage(problem) : '');
    riskError.textContent = risk.input.checked ? '' : t('investments:open.mustAccept');
    if (problem || !risk.input.checked) return;
    setBusy(submit, true);
    error.replaceChildren();
    try {
      const position = await investmentsApi.open({ productId: product.id, asset: assetSelect.value, amount: value, termsVersion: product.version, acceptRisk: true }, key.get());
      modal.close();
      toast(t('investments:open.done', { reference: position.reference }));
      onOpened?.(position);
    } catch (err) {
      if (err.code === 'terms_changed') key.reset();
      error.replaceChildren(alertBox({ tone: 'danger', text: errorMessage(err) }));
    } finally {
      setBusy(submit, false);
    }
  });
}
