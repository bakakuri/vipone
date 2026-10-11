// RFC 6238 TOTP (30-second steps, 6 digits, SHA-1) — compatible with common
// authenticator apps. Used by the local auth provider; Supabase Auth handles
// TOTP itself in production.

import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(secret, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

export function currentStep(nowMs = Date.now(), period = 30) {
  return Math.floor(nowMs / 1000 / period);
}

export function totp(secret, nowMs = Date.now()) {
  return hotp(secret, currentStep(nowMs));
}

/**
 * Returns the matched time step, or null. Rejects reuse of a step that was
 * already accepted (replay protection) when lastUsedStep is given.
 */
export function verifyTotp(secret, code, { nowMs = Date.now(), window = 1, lastUsedStep = null } = {}) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const step = currentStep(nowMs);
  for (let i = -window; i <= window; i += 1) {
    const candidate = step + i;
    if (lastUsedStep !== null && candidate <= Number(lastUsedStep)) continue;
    const expected = hotp(secret, candidate);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return candidate;
  }
  return null;
}

export function otpauthUri({ secret, accountName, issuer }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}
