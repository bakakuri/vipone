// Deposit through a method published by staff: QR (uploaded image or one
// generated from the address), the address with a copy button, then "I have
// sent it" — amount, transaction ID and the sending wallet, linked to the
// signed-in account. A report is only a claim: the balance changes after
// staff have found the payment on the blockchain and credited it.
import { depositsApi } from '../../api/endpoints.js';
import { h, icon, replace } from '../../core/dom.js';
import { getPref, setPref } from '../../core/storage.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { localized, t } from '../../i18n/i18n.js';
import { createActionKey } from '../../services/idempotency.js';
import { validateAmount } from '../../validation/validate-amount.js';
import { alertBox } from '../feedback/alert.js';
import { errorMessage, fieldErrorMessage } from '../feedback/error-message.js';
import { addressBox } from '../misc/address-display.js';
import { qrCode } from '../misc/qr-code.js';
import { openModal } from '../modals/modal.js';
import { amountInput } from '../forms/amount-input.js';
import { formField, input } from '../forms/form-field.js';
import { setBusy, showServerErrors } from '../forms/form-validation.js';

const TX_HASH = /^[A-Za-z0-9:_-]{8,128}$/;
const WALLET = /^[A-Za-z0-9:_-]{10,128}$/;

// Operator text: one paragraph per line, blank lines ignored. Text only — never HTML.
export function instructionText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? h('div', { class: 'deposit-instructions' }, lines.map((l) => h('p', {}, l))) : null;
}

const methodName = (m) => m.label || `${m.asset} · ${m.networkName}`;

function qrFor(m) {
  const label = t('deposit:qrLabel', { asset: m.asset, network: m.networkName });
  if (!m.qrImage) return qrCode(m.address, { label });
  const img = h('img', { src: m.qrImage, alt: label, class: 'deposit-address__image', decoding: 'async' });
  const zoom = h('button', { class: 'deposit-address__zoom', type: 'button', 'aria-label': t('deposit:manual.enlarge') }, img, h('span', { class: 'deposit-address__zoom-hint' }, icon('search', { size: 'sm' }), t('deposit:manual.enlarge')));
  zoom.addEventListener('click', () => {
    openModal({ title: methodName(m), body: h('div', { class: 'deposit-zoom' }, h('img', { src: m.qrImage, alt: label })), wide: true });
  });
  return zoom;
}

function methodPanel(m) {
  const memoLabel = m.memoLabel || t('deposit:memo');
  const instructions = instructionText(localized(m.instructions));
  return h('div', { class: 'deposit-address deposit-address--compact' },
    h('div', { class: `deposit-address__qr${m.qrImage ? ' deposit-address__qr--image' : ''}` }, qrFor(m)),
    h('div', { class: 'deposit-address__details stack stack--sm' },
      h('div', { class: 'deposit-address__network' }, h('strong', {}, m.asset), h('span', {}, m.networkName)),
      addressBox(m.address, { label: t('deposit:addressLabel', { asset: m.asset, network: m.networkName }) }),
      m.memo ? h('div', { class: 'stack stack--sm' }, h('div', { class: 'field__label' }, `${memoLabel} — ${t('deposit:manual.required')}`), addressBox(m.memo)) : null,
      h('p', { class: 'deposit-warning' }, icon('alert', { size: 'sm' }), t('deposit:manual.onlyNetwork', { asset: m.asset, network: m.networkName })),
      m.minAmount ? h('p', { class: 'text-xs text-subtle' }, t('deposit:manual.minimum', { amount: formatAmount(m.minAmount, m.asset) })) : null,
      instructions),
  );
}

export function manualDepositForm({ methods, assets, user, onReported }) {
  const byCode = Object.fromEntries(assets.map((a) => [a.code, a]));
  const savedAsset = getPref('depositAsset');
  const savedNetwork = getPref('depositNetwork');
  let current = methods.find((m) => m.asset === savedAsset && m.network === savedNetwork) || methods[0];

  const panelSlot = h('div', { class: 'deposit-form__address', 'aria-live': 'polite' });

  // Method picker: one chip per published method (hidden when there is only one).
  const choices = methods.map((m) => {
    const radio = h('input', { type: 'radio', name: 'deposit-method', value: m.id, checked: m.id === current.id, class: 'method-chip__input' });
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      current = m;
      setPref('depositAsset', m.asset);
      setPref('depositNetwork', m.network);
      render();
    });
    return h('label', { class: 'method-chip' }, radio,
      h('span', { class: 'method-chip__body' }, h('strong', {}, m.asset), h('span', { class: 'method-chip__net' }, m.label || m.networkName)));
  });
  const picker = methods.length > 1 ? h('div', { class: 'method-picker__list', role: 'radiogroup', 'aria-label': t('deposit:manual.chooseMethod') }, choices) : null;

  // "I have sent it": amount, transaction ID and the sending wallet.
  const key = createActionKey();
  const amountCtl = amountInput({});
  const amount = formField({ label: t('deposit:manual.amountSent'), control: amountCtl.control, body: amountCtl.el, id: 'man-amount' });
  const txHash = formField({ label: t('deposit:manual.txHash'), control: input({ dir: 'ltr', class: 'input input--mono', autocomplete: 'off', spellcheck: false, maxlength: 128 }), aside: t('common:optional'), id: 'man-hash' });
  const from = formField({ label: t('deposit:manual.fromAddress'), control: input({ dir: 'ltr', class: 'input input--mono', autocomplete: 'off', spellcheck: false, maxlength: 128 }), aside: t('common:optional'), id: 'man-from' });
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, icon('check'), t('deposit:manual.report'));
  const result = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'form manual-report', novalidate: true },
    h('div', { class: 'manual-report__head' },
      h('h3', { class: 'card__title' }, t('deposit:manual.reportTitle')),
      h('p', { class: 'text-xs text-muted' }, t('deposit:manual.reportHint', { email: user?.email || '' }))),
    h('div', { class: 'form-row' }, amount.el, txHash.el), from.el, submit, result);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const asset = byCode[current.asset];
    const value = amountCtl.value();
    const hash = txHash.control.value.trim();
    const wallet = from.control.value.trim();
    const amountProblem = validateAmount(value, { decimals: asset?.decimals ?? 18 });
    amount.setError(amountProblem ? fieldErrorMessage(amountProblem) : '');
    txHash.setError(hash && !TX_HASH.test(hash) ? t('deposit:manual.txHashInvalid') : '');
    from.setError(wallet && !WALLET.test(wallet) ? t('errors:validation.address_invalid') : '');
    if (amountProblem || (hash && !TX_HASH.test(hash)) || (wallet && !WALLET.test(wallet))) return;
    setBusy(submit, true);
    try {
      const dep = await depositsApi.reportManual({ methodId: current.id, amount: value, txHash: hash || undefined, fromAddress: wallet || undefined }, key.get());
      key.reset();
      form.reset();
      replace(result, alertBox({
        tone: 'success',
        title: t('deposit:manual.reported', { reference: dep.reference }),
        text: t('deposit:manual.reportedText', { amount: formatAmount(dep.claimedAmount || value, current.asset) }),
      }));
      onReported?.(dep);
    } catch (err) {
      if (err.code === 'validation_failed') showServerErrors(err, { amount, txHash, fromAddress: from });
      else replace(result, alertBox({ tone: 'danger', text: errorMessage(err) }));
    } finally {
      setBusy(submit, false);
    }
  });

  function render() {
    amountCtl.setAsset(current.asset);
    replace(result);
    replace(panelSlot, methodPanel(current));
  }
  render();

  return { el: h('div', { class: 'stack deposit-form' }, picker, panelSlot, form) };
}
