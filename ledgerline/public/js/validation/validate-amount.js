// Amount format validation shared by browser and server. Amounts are decimal
// strings: no exponent, no thousands separators, at most `decimals` places.
// Comparing against balances or limits happens only on the server.

const AMOUNT_RE = /^(?:0|[1-9]\d{0,19})(?:\.(\d{1,18}))?$/;

export function normalizeAmountInput(value) {
  // Accept a comma as decimal separator (ru/ar keyboards) and Arabic-Indic digits.
  return String(value ?? '')
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s  ]/g, '')
    .replace(/[,٫]/, '.');
}

export function validateAmount(value, { decimals = 18, allowZero = false } = {}) {
  const amount = normalizeAmountInput(value);
  if (!amount) return 'required';
  const match = AMOUNT_RE.exec(amount);
  if (!match) return 'amount_invalid';
  if (match[1] && match[1].length > decimals) return 'amount_precision';
  if (!allowZero && /^0(?:\.0+)?$/.test(amount)) return 'amount_positive';
  return null;
}
