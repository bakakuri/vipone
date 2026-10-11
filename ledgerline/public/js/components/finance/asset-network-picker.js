// Asset + network choice shared by deposits, wallets and withdrawals. Only the
// combinations the server enables for the operation are offered, so a user
// cannot pick a network the platform does not support for that asset.
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { formField, select } from '../forms/form-field.js';

export function assetNetworkPicker({ assets, operation = 'deposit', value = {}, onChange, idPrefix = 'an' }) {
  const enabledKey = operation === 'withdrawal' ? 'withdrawalEnabled' : 'depositEnabled';
  const usable = assets
    .map((a) => ({ ...a, networks: a.networks.filter((n) => n[enabledKey]) }))
    .filter((a) => a.networks.length);

  const assetSelect = select(usable.map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` })), { name: 'asset', value: value.asset });
  const networkSelect = select([], { name: 'network' });
  const assetField = formField({ label: t('common:fields.asset'), control: assetSelect, id: `${idPrefix}-asset` });
  const networkField = formField({ label: t('common:fields.network'), control: networkSelect, id: `${idPrefix}-network`, hint: t('common:fields.networkHint') });

  const current = () => {
    const asset = usable.find((a) => a.code === assetSelect.value) || usable[0];
    const network = asset?.networks.find((n) => n.code === networkSelect.value) || asset?.networks[0];
    return { asset, network };
  };

  function fillNetworks(preferred) {
    const asset = usable.find((a) => a.code === assetSelect.value) || usable[0];
    networkSelect.replaceChildren(...(asset?.networks || []).map((n) =>
      h('option', { value: n.code, selected: n.code === preferred }, n.tokenStandard ? `${n.name} (${n.tokenStandard})` : n.name)));
  }

  fillNetworks(value.network);
  assetSelect.addEventListener('change', () => {
    fillNetworks();
    onChange?.(current());
  });
  networkSelect.addEventListener('change', () => onChange?.(current()));

  return {
    el: h('div', { class: 'form-row' }, assetField.el, networkField.el),
    fields: { asset: assetField, network: networkField },
    current,
    isEmpty: usable.length === 0,
  };
}
