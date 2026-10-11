// Locale-aware number formatting. Accepts decimal strings so money values
// keep their exact digits (Intl.NumberFormat formats numeric strings exactly
// in current browsers).
import { formatLocale } from '../i18n/i18n.js';

export function formatNumber(value, { min = 0, max = 2, signDisplay = 'auto' } = {}) {
  if (value === null || value === undefined || value === '') return '—';
  return new Intl.NumberFormat(formatLocale(), { minimumFractionDigits: min, maximumFractionDigits: max, signDisplay }).format(value);
}

export function formatPercent(rate, { max = 2, signDisplay = 'auto' } = {}) {
  if (rate === null || rate === undefined || rate === '') return '—';
  return new Intl.NumberFormat(formatLocale(), { style: 'percent', maximumFractionDigits: max, signDisplay }).format(rate);
}

export function formatInteger(value) {
  return new Intl.NumberFormat(formatLocale(), { maximumFractionDigits: 0 }).format(value ?? 0);
}
