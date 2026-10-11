// Webhook signature verification. Both schemes compare HMACs in constant time
// over the exact raw request body.

import { hmacSha256, timingSafeEqualString } from '../../security/crypto.js';

// Generic scheme used by a custody provider or our own chain watcher:
//   X-Ledgerline-Signature: t=<unix seconds>,v1=<hex hmac_sha256(secret, `${t}.${rawBody}`)>
export function signGeneric(secret, rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${rawBody}`)}`;
}

export function verifyGenericSignature(secret, rawBody, header, { toleranceSeconds = 300, now = Date.now() } = {}) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    String(header)
      .split(',')
      .map((p) => p.trim().split('='))
      .filter((kv) => kv.length === 2),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  return timingSafeEqualString(hmacSha256(secret, `${t}.${rawBody}`), parts.v1 || '');
}

// Alchemy Notify: X-Alchemy-Signature = hex(hmac_sha256(signingKey, rawBody))
export function verifyAlchemySignature(signingKeys, rawBody, header) {
  if (!header || !signingKeys?.length) return false;
  return signingKeys.some((key) => timingSafeEqualString(hmacSha256(key, rawBody), header));
}
