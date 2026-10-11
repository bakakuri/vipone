// Small cryptographic helpers built on node:crypto.

import crypto from 'node:crypto';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randomNumericCode(digits = 6) {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, '0');
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(secret, value, encoding = 'hex') {
  return crypto.createHmac('sha256', secret).update(value).digest(encoding);
}

export function timingSafeEqualString(a, b) {
  const ab = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// IP addresses are stored only as keyed hashes (privacy by design).
export function hashIp(ip, secret) {
  if (!ip) return null;
  return hmacSha256(secret, `ip:${ip}`).slice(0, 32);
}

// scrypt password hashing (local auth provider only; Supabase Auth hashes
// passwords itself in production).
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// AES-256-GCM with a key derived from a secret (local MFA secrets at rest).
function deriveKey(secret, purpose) {
  return crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), Buffer.from(purpose), 32);
}

export function encrypt(plaintext, secret, purpose = 'ledgerline:data') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(deriveKey(secret, purpose)), iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}

export function decrypt(ciphertext, secret, purpose = 'ledgerline:data') {
  const [version, iv, tag, body] = String(ciphertext).split('.');
  if (version !== 'v1') throw new Error('unsupported ciphertext');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(deriveKey(secret, purpose)), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
