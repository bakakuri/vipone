// Reference prices (USD) — display only. Balances are always kept per asset;
// a USD total on the dashboard is labelled as an approximate valuation.

import { getConfig } from '../../config/env.js';
import { AppError } from '../../core/errors.js';

const COINGECKO_IDS = { BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', USDC: 'usd-coin' };

export function createPriceProvider(config, { fetchImpl = fetch } = {}) {
  if (config.prices.provider === 'coingecko') {
    return {
      name: 'coingecko',
      async fetchPrices(assets) {
        const ids = assets.map((a) => COINGECKO_IDS[a]).filter(Boolean);
        if (!ids.length) return {};
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&precision=full`;
        const res = await fetchImpl(url, {
          headers: config.prices.coingeckoKey ? { 'x-cg-demo-api-key': config.prices.coingeckoKey } : {},
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new AppError('service_unavailable', { details: { provider: 'coingecko', status: res.status } });
        const body = await res.json();
        const out = {};
        for (const asset of assets) {
          const usd = body[COINGECKO_IDS[asset]]?.usd;
          if (usd !== undefined) out[asset] = String(usd);
        }
        return out;
      },
    };
  }
  return {
    name: 'static',
    async fetchPrices(assets) {
      return Object.fromEntries(assets.filter((a) => config.prices.staticPrices[a] !== undefined).map((a) => [a, String(config.prices.staticPrices[a])]));
    },
  };
}

let provider;
export function getPriceProvider() {
  if (!provider) provider = createPriceProvider(getConfig());
  return provider;
}
