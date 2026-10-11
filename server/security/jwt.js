// Minimal, strict JWT (JWS compact) implementation on node:crypto.
// Supports HS256 (local provider, legacy Supabase projects) and ES256/RS256
// verified against a JWKS (Supabase asymmetric signing keys).
// Algorithms are allow-listed; "none" and key-confusion are rejected.

import crypto from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (str) => Buffer.from(str, 'base64url');

export class JwtError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export function signHs256(payload, secret, { expiresInSeconds, now = Math.floor(Date.now() / 1000) } = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { iat: now, ...payload };
  if (expiresInSeconds) body.exp = now + expiresInSeconds;
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${b64url(signature)}`;
}

export function decodeUnverified(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new JwtError('malformed', 'token is not a JWS');
  try {
    return {
      header: JSON.parse(fromB64url(parts[0]).toString('utf8')),
      payload: JSON.parse(fromB64url(parts[1]).toString('utf8')),
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: fromB64url(parts[2]),
    };
  } catch {
    throw new JwtError('malformed', 'token parts are not valid JSON');
  }
}

/**
 * @param {string} token
 * @param {{hsSecret?: string, getJwk?: (kid: string) => Promise<object|null>, audience?: string,
 *          issuer?: string, leewaySeconds?: number, now?: number}} opts
 */
export async function verifyJwt(token, opts = {}) {
  const { header, payload, signingInput, signature } = decodeUnverified(token);
  const leeway = opts.leewaySeconds ?? 30;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  let valid = false;
  if (header.alg === 'HS256') {
    if (!opts.hsSecret) throw new JwtError('unsupported_alg', 'HS256 tokens are not accepted');
    const expected = crypto.createHmac('sha256', opts.hsSecret).update(signingInput).digest();
    valid = expected.length === signature.length && crypto.timingSafeEqual(expected, signature);
  } else if (header.alg === 'ES256' || header.alg === 'RS256') {
    if (!opts.getJwk || !header.kid) throw new JwtError('unsupported_alg', `${header.alg} requires a JWKS key id`);
    const jwk = await opts.getJwk(header.kid);
    if (!jwk) throw new JwtError('unknown_key', 'signing key not found');
    if ((header.alg === 'ES256' && jwk.kty !== 'EC') || (header.alg === 'RS256' && jwk.kty !== 'RSA')) {
      throw new JwtError('invalid_signature', 'key type does not match algorithm');
    }
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    valid =
      header.alg === 'ES256'
        ? crypto.verify('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' }, signature)
        : crypto.verify('RSA-SHA256', Buffer.from(signingInput), key, signature);
  } else {
    throw new JwtError('unsupported_alg', `algorithm ${header.alg} is not allowed`);
  }

  if (!valid) throw new JwtError('invalid_signature', 'signature verification failed');
  if (typeof payload.exp !== 'number') throw new JwtError('invalid_claims', 'exp is required');
  if (payload.exp + leeway < now) throw new JwtError('expired', 'token has expired');
  if (typeof payload.nbf === 'number' && payload.nbf - leeway > now) throw new JwtError('not_yet_valid', 'token not yet valid');
  if (opts.audience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(opts.audience)) throw new JwtError('invalid_claims', 'audience mismatch');
  }
  if (opts.issuer && payload.iss !== opts.issuer) throw new JwtError('invalid_claims', 'issuer mismatch');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new JwtError('invalid_claims', 'sub is required');
  return payload;
}

// JWKS cache with refresh on unknown kid (rate limited to protect the issuer).
export function createJwksResolver(jwksUrl, { fetchImpl = fetch, ttlMs = 10 * 60 * 1000, minRefreshMs = 30 * 1000 } = {}) {
  let keys = new Map();
  let fetchedAt = 0;
  let inflight = null;

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      const res = await fetchImpl(jwksUrl, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new JwtError('jwks_unavailable', `JWKS fetch failed with ${res.status}`);
      const body = await res.json();
      keys = new Map((body.keys || []).filter((k) => k.kid).map((k) => [k.kid, k]));
      fetchedAt = Date.now();
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return async function getJwk(kid) {
    const stale = Date.now() - fetchedAt > ttlMs;
    if (stale || (!keys.has(kid) && Date.now() - fetchedAt > minRefreshMs)) {
      await refresh();
    }
    return keys.get(kid) || null;
  };
}
