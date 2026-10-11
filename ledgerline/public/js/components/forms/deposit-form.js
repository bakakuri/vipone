// Deposit: choose asset and network -> get your personal address (QR, memo,
// rules). Optionally tell us the amount you are sending: it creates a
// reference so support can match the payment faster. Funds are credited only
// after the blockchain confirmations arrive — never from this form.
import { depositsApi } from '../../api/endpoints.js';
import { h, icon, replace } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { createActionKey } from '../../services/idempotency.js';
import { validateAmount } from '../../validation/validate-amount.js';
import { alertBox } from '../feedback/alert.js';
import { errorMessage, fieldErrorMessage } from '../feedback/error-message.js';
import { skeletonBlock } from '../feedback/skeleton.js';
import { assetNetworkPicker } from '../finance/asset-network-picker.js';
import { depositAddressPanel } from '../finance/deposit-address.js';
import { amountInput } from './amount-input.js';
import { formField } from './form-field.js';
import { setBusy } from './form-validation.js';
import { getPref, setPref } from '../../core/storage.js';

export function depositForm({ assets, holdDays = 7, onRequested }) {
  const saved = { asset: getPref('depositAsset'), network: getPref('depositNetwork') };
  const addressSlot = h('div', { class: 'deposit-form__address', 'aria-live': 'polite' });
  const picker = assetNetworkPicker({ assets, operation: 'deposit', value: saved, idPrefix: 'dep', onChange: () => loadAddress() });
  if (picker.isEmpty) {
    return { el: alertBox({ tone: 'warning', title: t('deposit:unavailableTitle'), text: t('deposit:unavailableText') }) };
  }

  let seq = 0;
  async function loadAddress() {
    const { asset, network } = picker.current();
    setPref('depositAsset', asset.code);
    setPref('depositNetwork', network.code);
    const mine = (seq += 1);
    replace(addressSlot, h('div', { class: 'deposit-address deposit-address--loading' }, skeletonBlock(), skeletonBlock()));
    try {
      const address = await depositsApi.address(network.code);
      if (mine !== seq) return;
      replace(addressSlot, depositAddressPanel({ address, asset, network, holdDays }));
    } catch (err) {
      if (mine !== seq) return;
      const action = err.code === 'kyc_required' ? h('a', { class: 'btn btn--sm btn--primary', href: '/profile#verification' }, t('deposit:verifyIdentity')) : null;
      replace(addressSlot, alertBox({ tone: err.code === 'kyc_required' ? 'info' : 'danger', text: errorMessage(err), action }));
    }
  }

  // Optional: announce the amount you are about to send.
  const key = createActionKey();
  const amountCtl = amountInput({});
  const amountField = formField({ label: t('deposit:expectedAmount'), control: amountCtl.control, body: amountCtl.el, hint: t('deposit:expectedAmountHint'), id: 'dep-expected' });
  const requestBtn = h('button', { class: 'btn btn--sm', type: 'submit' }, t('deposit:createReference'));
  const requestResult = h('div', { 'aria-live': 'polite' });
  const requestForm = h('form', { class: 'form', novalidate: true }, amountField.el, h('div', { class: 'cluster' }, requestBtn), requestResult);
  requestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { asset, network } = picker.current();
    const value = amountCtl.value();
    const problem = validateAmount(value, { decimals: asset.decimals });
    amountField.setError(problem ? fieldErrorMessage(problem) : '');
    if (problem) return;
    setBusy(requestBtn, true);
    try {
      const request = await depositsApi.request({ asset: asset.code, network: network.code, expectedAmount: value }, key.get());
      key.reset();
      amountCtl.control.value = '';
      replace(requestResult, alertBox({
        tone: 'success',
        title: t('deposit:referenceCreated', { reference: request.reference }),
        text: t('deposit:referenceText', { amount: formatAmount(request.expectedAmount, asset.code), date: formatDateTime(request.expiresAt) }),
      }));
      onRequested?.(request);
    } catch (err) {
      replace(requestResult, alertBox({ tone: 'danger', text: errorMessage(err) }));
    } finally {
      setBusy(requestBtn, false);
    }
  });
  const syncUnit = () => amountCtl.setAsset(picker.current().asset.code);
  picker.el.addEventListener('change', syncUnit);
  syncUnit();

  loadAddress();
  return {
    el: h('div', { class: 'stack deposit-form' },
      picker.el,
      addressSlot,
      h('details', { class: 'disclosure' },
        h('summary', {}, icon('file', { size: 'sm' }), t('deposit:announceTitle')),
        h('div', { class: 'disclosure__body' }, requestForm))),
    reload: loadAddress,
  };
}
