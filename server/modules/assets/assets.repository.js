// Supported assets and networks (reference data used by many modules).

import { camelize, trimAmount } from '../../utils/camelize.js';

export async function listAssetNetworks(db) {
  const rows = await db`
    select a.code as asset_code, a.name as asset_name, a.decimals, a.display_decimals, a.sort_order,
           n.code as network_code, n.name as network_name, n.family, n.address_pattern, n.memo_required,
           n.memo_pattern, n.memo_label, n.explorer_tx_url, n.explorer_address_url, n.required_confirmations,
           an.token_standard, an.token_contract, an.deposit_enabled, an.withdrawal_enabled, an.min_deposit,
           an.min_withdrawal, an.withdrawal_network_fee
    from app.asset_networks an
    join app.assets a on a.code = an.asset_code and a.is_active
    join app.networks n on n.code = an.network_code and n.is_active
    order by a.sort_order, a.code, n.code`;
  const assets = new Map();
  for (const r of rows) {
    if (!assets.has(r.asset_code)) {
      assets.set(r.asset_code, { code: r.asset_code, name: r.asset_name, decimals: r.decimals, displayDecimals: r.display_decimals, networks: [] });
    }
    assets.get(r.asset_code).networks.push({
      code: r.network_code,
      name: r.network_name,
      family: r.family,
      tokenStandard: r.token_standard,
      tokenContract: r.token_contract,
      addressPattern: r.address_pattern,
      memoRequired: r.memo_required,
      memoPattern: r.memo_pattern,
      memoLabel: r.memo_label,
      explorerTxUrl: r.explorer_tx_url,
      explorerAddressUrl: r.explorer_address_url,
      requiredConfirmations: r.required_confirmations,
      depositEnabled: r.deposit_enabled,
      withdrawalEnabled: r.withdrawal_enabled,
      minDeposit: trimAmount(r.min_deposit),
      minWithdrawal: trimAmount(r.min_withdrawal),
      withdrawalNetworkFee: trimAmount(r.withdrawal_network_fee),
    });
  }
  return [...assets.values()];
}

export async function getAssetNetwork(db, assetCode, networkCode) {
  const [row] = await db`
    select a.code as asset_code, a.decimals, n.code as network_code, n.name as network_name, an.token_standard, n.family,
           n.address_pattern, n.memo_required, n.memo_pattern, n.memo_label, n.required_confirmations, n.explorer_tx_url, an.deposit_enabled,
           an.withdrawal_enabled, an.min_deposit, an.min_withdrawal, an.withdrawal_network_fee, an.token_contract
    from app.asset_networks an
    join app.assets a on a.code = an.asset_code and a.is_active
    join app.networks n on n.code = an.network_code and n.is_active
    where an.asset_code = ${assetCode} and an.network_code = ${networkCode}`;
  return row ? camelize(row) : null;
}

export async function getAsset(db, code) {
  const [row] = await db`select code, name, decimals, display_decimals from app.assets where code = ${code} and is_active`;
  return row ? camelize(row) : null;
}

export async function getNetwork(db, code) {
  const [row] = await db`select * from app.networks where code = ${code}`;
  return row ? camelize(row) : null;
}

export async function assetByTokenContract(db, networkCode, contract) {
  const [row] = await db`
    select asset_code from app.asset_networks
    where network_code = ${networkCode} and lower(token_contract) = lower(${contract})`;
  return row?.asset_code ?? null;
}

export function explorerTxUrl(template, txHash) {
  return template && txHash ? template.replace('{tx}', encodeURIComponent(txHash)) : null;
}
