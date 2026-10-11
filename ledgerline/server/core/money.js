// Exact decimal arithmetic for money. JavaScript numbers are never used for
// amounts: values travel as strings and are computed with decimal.js.

import Decimal from 'decimal.js';

export const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_DOWN, toExpNeg: -40, toExpPos: 60 });

const AMOUNT_RE = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/;

export function isAmountString(value) {
  return typeof value === 'string' && AMOUNT_RE.test(value);
}

export function dec(value) {
  return new D(value);
}

// Canonical string without exponent or trailing zeros ("12.5", "0.000001").
export function toAmountString(value) {
  const d = value instanceof D ? value : new D(value);
  return d.toFixed().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

// Truncates toward zero to the asset precision (never rounds up user credits).
export function truncate(value, decimals) {
  return (value instanceof D ? value : new D(value)).toDecimalPlaces(decimals, D.ROUND_DOWN);
}

// Rounds half-up; used for fees charged by the platform.
export function roundHalfUp(value, decimals) {
  return (value instanceof D ? value : new D(value)).toDecimalPlaces(decimals, D.ROUND_HALF_UP);
}

export function hasAtMostDecimals(value, decimals) {
  const d = new D(value);
  return d.decimalPlaces() <= decimals;
}

export function max(a, b) {
  return D.max(a, b);
}

export function min(a, b) {
  return D.min(a, b);
}
