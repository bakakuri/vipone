// Converts a percentage typed by staff ("1.25", "-0.4") into a decimal rate
// string ("0.0125", "-0.004") exactly, without floating point. Returns null
// for anything that is not a plain number with up to 2 integer and 6
// fractional digits.
export function percentToRate(value) {
  const v = String(value ?? '').trim().replace(',', '.');
  if (!/^-?\d{1,2}(\.\d{1,6})?$/.test(v)) return null;
  const negative = v.startsWith('-');
  const [int, frac = ''] = v.replace('-', '').split('.');
  const scale = frac.length + 2;
  const digits = (int + frac).padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale).replace(/^0+(?=\d)/, '');
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  const out = fraction ? `${whole}.${fraction}` : whole;
  return out === '0' ? '0' : `${negative ? '-' : ''}${out}`;
}
