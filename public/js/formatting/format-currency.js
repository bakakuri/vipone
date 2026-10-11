// Crypto amounts: "1,234.5 USDT". Precision comes from the asset definition
// (registered via registerAssets from /api/v1/public/assets).
import { formatLocale } from '../i18n/i18n.js';

const DECIMALS = { USDT: 6, USDC: 6, BTC: 8, ETH: 18 };
const DISPLAY = { USDT: 2, USDC: 2, BTC: 8, ETH: 6 };

export function registerAssets(assets) {
  for (const a of assets || []) {
    DECIMALS[a.code] = a.decimals;
    DISPLAY[a.code] = a.displayDecimals;
  }
}

export function assetDecimals(asset) {
  return DECIMALS[asset] ?? 8;
}

export function formatAmount(amount, asset, { sign = false, withAsset = true, compact = false } = {}) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const decimals = DECIMALS[asset] ?? 8;
  const display = Math.min(DISPLAY[asset] ?? 2, decimals);
  const formatted = new Intl.NumberFormat(formatLocale(), {
    minimumFractionDigits: compact ? 0 : Math.min(2, display),
    maximumFractionDigits: compact ? display : Math.max(display, Math.min(decimals, 8)),
    signDisplay: sign ? 'exceptZero' : 'auto',
  }).format(amount);
  return withAsset && asset ? `${formatted} ${asset}` : formatted;
}

export function formatUsd(amount) {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat(formatLocale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount);
}

export function isNegative(amount) {
  return typeof amount === 'string' ? amount.trim().startsWith('-') : Number(amount) < 0;
}

export function isZero(amount) {
  return amount === null || amount === undefined || /^-?0*(\.0*)?$/.test(String(amount));
}
