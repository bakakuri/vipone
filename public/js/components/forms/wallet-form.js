// Adding a withdrawal address: label, asset, network, address (+ memo/tag
// where the network needs one). Only the public address is stored; the
// platform never asks for a private key or seed phrase. A new address must
// be confirmed with an emailed code and then waits out a cooldown.
import { walletsApi } from '../../api/endpoints.js';
import { h, replace } from '../../core/dom.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { validateWalletAddress } from '../../validation/validate-wallet-address.js';
import { alertBox } from '../feedback/alert.js';
import { errorMessage, fieldErrorMessage } from '../feedback/error-message.js';
import { assetNetworkPicker } from '../finance/asset-network-picker.js';
import { addressBox } from '../misc/address-display.js';
import { withMfa } from '../modals/mfa-dialog.js';
import { openModal } from '../modals/modal.js';
import { toast } from '../notifications/toast.js';
import { formField, input } from './form-field.js';
import { otpInput } from './otp-input.js';
import { setBusy, showServerErrors } from './form-validation.js';

export function walletForm({ assets, onAdded }) {
  const label = formField({ label: t('wallets:label'), control: input({ name: 'label', maxLength: 60, autocomplete: 'off', placeholder: t('wallets:labelPlaceholder') }), id: 'wallet-label' });
  const picker = assetNetworkPicker({ assets, operation: 'withdrawal', idPrefix: 'wallet', onChange: () => syncNetwork() });
  const address = formField({
    label: t('wallets:address'),
    control: input({ name: 'address', mono: true, dir: 'ltr', autocomplete: 'off', spellcheck: false, autocapitalize: 'off', maxLength: 128 }),
    id: 'wallet-address',
  });
  const memo = formField({ label: t('wallets:memo'), control: input({ name: 'memo', mono: true, dir: 'ltr', autocomplete: 'off', maxLength: 64 }), id: 'wallet-memo' });
  const networkNote = h('div');
  const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, t('wallets:add'));
  const form = h('form', { class: 'form', novalidate: true },
    label.el, picker.el, address.el, memo.el, networkNote,
    alertBox({ tone: 'info', text: t('wallets:neverKeys') }),
    h('div', { class: 'cluster' }, submit));

  function syncNetwork() {
    const { asset, network } = picker.current();
    if (!network) return;
    memo.el.hidden = !network.memoRequired;
    memo.el.querySelector('.field__label span').textContent = network.memoLabel || t('wallets:memo');
    replace(networkNote, network.memoRequired
      ? alertBox({ tone: 'warning', text: t('wallets:memoNeeded', { label: network.memoLabel || t('wallets:memo') }) })
      : h('p', { class: 'field__hint' }, t('wallets:networkCheck', { asset: asset.code, network: network.name })));
  }
  syncNetwork();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { asset, network } = picker.current();
    const values = { label: label.control.value.trim(), address: address.control.value.trim(), memo: memo.el.hidden ? '' : memo.control.value.trim() };
    label.setError(values.label ? '' : t('errors:validation.required'));
    const problem = validateWalletAddress(values.address, network, values.memo);
    address.setError(problem && !problem.startsWith('memo') ? fieldErrorMessage(problem) : '');
    memo.setError(problem && problem.startsWith('memo') ? fieldErrorMessage(problem) : '');
    if (!values.label || problem) {
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    setBusy(submit, true);
    try {
      const wallet = await withMfa(() => walletsApi.add({ ...values, asset: asset.code, network: network.code }));
      form.reset();
      syncNetwork();
      onAdded?.(wallet);
      if (wallet.status === 'active') toast(t('wallets:confirmedToast', { date: formatDateTime(wallet.usableFrom) }));
      else confirmWalletDialog(wallet, { onConfirmed: onAdded });
    } catch (err) {
      if (err.code === 'mfa_setup_required') {
        toast(errorMessage(err), { tone: 'warning' });
        return;
      }
      showServerErrors(err, { label, address, memo, asset: picker.fields.asset, network: picker.fields.network });
    } finally {
      setBusy(submit, false);
    }
  });

  return { el: form, isEmpty: picker.isEmpty };
}

// Enter the 6-digit code from the confirmation email.
export function confirmWalletDialog(wallet, { onConfirmed } = {}) {
  const error = h('div', { class: 'field__error', role: 'alert' });
  const resend = h('button', { class: 'link-button text-small', type: 'button' }, t('wallets:resend'));
  let busy = false;
  const otp = otpInput({
    label: t('wallets:codeLabel'),
    onComplete: async (code) => {
      if (busy) return;
      busy = true;
      error.textContent = '';
      try {
        const confirmed = await walletsApi.confirm(wallet.id, code);
        modal.close();
        toast(t('wallets:confirmedToast', { date: formatDateTime(confirmed.usableFrom) }));
        onConfirmed?.(confirmed);
      } catch (err) {
        error.textContent = errorMessage(err);
        otp.clear();
      } finally {
        busy = false;
      }
    },
  });
  resend.addEventListener('click', async () => {
    try {
      await walletsApi.resendCode(wallet.id);
      toast(t('wallets:resent'));
    } catch (err) {
      error.textContent = errorMessage(err);
    }
  });
  const modal = openModal({
    title: t('wallets:confirmTitle'),
    body: [
      h('p', { class: 'text-muted' }, t('wallets:confirmText', { label: wallet.label })),
      addressBox(wallet.address),
      otp.el,
      error,
      wallet.devCode ? alertBox({ tone: 'neutral', text: t('wallets:devCode', { code: wallet.devCode }) }) : null,
      resend,
    ],
  });
  otp.focus();
  return modal;
}
