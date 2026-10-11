// Shortened identifiers for tables: "TQn9Y2…5KcbLSE". Full values are always
// available on hover/copy and in detail views.
export function shortenMiddle(value, head = 6, tail = 6) {
  if (!value) return '—';
  const s = String(value);
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function explorerUrl(template, value, key = 'tx') {
  return template && value ? template.replace(`{${key}}`, encodeURIComponent(value)) : null;
}
