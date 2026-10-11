// Current block height per network, used to update confirmation counts of
// detected deposits. RPC endpoints come from CHAIN_RPC_URLS, e.g.
// {"ETHEREUM":"https://eth-mainnet.g.alchemy.com/v2/<key>","TRON":"https://api.trongrid.io",
//  "BITCOIN":"https://mempool.space/api"}

import { AppError } from '../../core/errors.js';

async function fetchJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new AppError('service_unavailable', { details: { status: res.status } });
  return res.json();
}

export async function getTipHeight(family, rpcUrl) {
  if (!rpcUrl) throw new AppError('feature_unavailable', { details: { reason: 'rpc_not_configured' } });
  if (family === 'evm') {
    const body = await fetchJson(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    });
    return Number.parseInt(body.result, 16);
  }
  if (family === 'tron') {
    const body = await fetchJson(`${rpcUrl.replace(/\/$/, '')}/wallet/getnowblock`, { method: 'POST' });
    return Number(body.block_header?.raw_data?.number);
  }
  if (family === 'bitcoin') {
    const res = await fetch(`${rpcUrl.replace(/\/$/, '')}/blocks/tip/height`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new AppError('service_unavailable');
    return Number(await res.text());
  }
  throw new AppError('feature_unavailable', { details: { reason: `no tip source for ${family}` } });
}

export function confirmationsFrom(tipHeight, blockNumber) {
  if (!Number.isFinite(tipHeight) || !Number.isFinite(blockNumber)) return 0;
  return Math.max(0, tipHeight - blockNumber + 1);
}
