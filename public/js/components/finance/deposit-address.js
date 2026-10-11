// The deposit address panel: QR, address, memo/tag, and the rules that
// matter before sending (asset, network, minimum, confirmations, 7-day hold).
import { h, icon } from '../../core/dom.js';
import { formatAmount } from '../../formatting/format-currency.js';
import { t } from '../../i18n/i18n.js';
import { alertBox } from '../feedback/alert.js';
import { addressBox } from '../misc/address-display.js';
import { qrCode } from '../misc/qr-code.js';

export function depositAddressPanel({ address, asset, network, holdDays }) {
  const memoRequired = Boolean(address.memo);
  const rules = h('ul', { class: 'deposit-rules' },
    h('li', {}, icon('check', { size: 'sm' }), t('deposit:rules.onlyAsset', { asset: asset.code, network: network.name })),
    h('li', {}, icon('check', { size: 'sm' }), t('deposit:rules.minimum', { amount: formatAmount(network.minDeposit, asset.code) })),
    h('li', {}, icon('check', { size: 'sm' }), t('deposit:rules.confirmations', { count: address.requiredConfirmations })),
    h('li', {}, icon('clock', { size: 'sm' }), t('deposit:rules.hold', { count: holdDays })),
  );
  return h('div', { class: 'deposit-address' },
    h('div', { class: 'deposit-address__qr' }, qrCode(address.address, { label: t('deposit:qrLabel', { asset: asset.code, network: network.name }) })),
    h('div', { class: 'deposit-address__details stack' },
      h('div', { class: 'stack stack--sm' },
        h('div', { class: 'field__label' }, t('deposit:addressLabel', { asset: asset.code, network: network.name })),
        addressBox(address.address, { label: t('deposit:addressLabel', { asset: asset.code, network: network.name }) })),
      memoRequired
        ? h('div', { class: 'stack stack--sm' },
            h('div', { class: 'field__label' }, address.memoLabel || t('deposit:memo')),
            addressBox(address.memo),
            alertBox({ tone: 'danger', title: t('deposit:memoRequiredTitle', { label: address.memoLabel || t('deposit:memo') }), text: t('deposit:memoRequiredText') }))
        : null,
      alertBox({ tone: 'warning', title: t('deposit:wrongNetworkTitle'), text: t('deposit:wrongNetworkText', { asset: asset.code, network: network.name }) }),
      rules),
  );
}
