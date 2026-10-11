// Converts database rows (snake_case, Date objects) into API objects
// (camelCase, ISO strings). Numeric columns stay strings: money is never
// converted to a JavaScript number.

const toCamel = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

export function camelize(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(camelize);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[toCamel(k)] = v instanceof Date ? v.toISOString() : v;
    return out;
  }
  return value;
}

export const camelizeAll = (rows) => rows.map(camelize);

// Removes trailing zeros from NUMERIC strings ("12.500000000000000000" -> "12.5").
export function trimAmount(value) {
  if (value === null || value === undefined) return value;
  const s = String(value);
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function trimAmounts(obj, keys) {
  const out = { ...obj };
  for (const k of keys) if (k in out) out[k] = trimAmount(out[k]);
  return out;
}
