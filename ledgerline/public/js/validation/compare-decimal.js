// Compares two non-negative or negative decimal strings exactly (no floating
// point): returns -1, 0 or 1. Used for display decisions only — the server
// always performs the authoritative check.
function parts(value) {
  let s = String(value ?? '0').trim();
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  const [int = '0', frac = ''] = s.split('.');
  return { negative, int: int.replace(/^0+(?=\d)/, '') || '0', frac: frac.replace(/0+$/, '') };
}

function compareAbs(a, b) {
  if (a.int.length !== b.int.length) return a.int.length > b.int.length ? 1 : -1;
  if (a.int !== b.int) return a.int > b.int ? 1 : -1;
  const len = Math.max(a.frac.length, b.frac.length);
  const fa = a.frac.padEnd(len, '0');
  const fb = b.frac.padEnd(len, '0');
  if (fa === fb) return 0;
  return fa > fb ? 1 : -1;
}

export function compareDecimal(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  const zeroA = pa.int === '0' && !pa.frac;
  const zeroB = pb.int === '0' && !pb.frac;
  if (zeroA) pa.negative = false;
  if (zeroB) pb.negative = false;
  if (pa.negative !== pb.negative) return pa.negative ? -1 : 1;
  const c = compareAbs(pa, pb);
  return pa.negative ? -c : c;
}
