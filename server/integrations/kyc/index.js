// Identity verification.
//   KYC_PROVIDER=manual  compliance staff review documents outside the platform
//                        and record the decision in the admin panel (demo/dev)
//   KYC_PROVIDER=sumsub  hosted Sumsub WebSDK link + signed webhook
// Verify endpoint paths against the current Sumsub API reference before go-live.

import { getConfig } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { hmacSha256, timingSafeEqualString } from '../../security/crypto.js';
import crypto from 'node:crypto';

export function createSumsubProvider(cfg, { fetchImpl = fetch } = {}) {
  async function signedRequest(method, pathWithQuery, body) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = body ? JSON.stringify(body) : '';
    const signature = hmacSha256(cfg.secretKey, ts + method + pathWithQuery + payload);
    const res = await fetchImpl(cfg.baseUrl + pathWithQuery, {
      method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'X-App-Token': cfg.appToken,
        'X-App-Access-Ts': ts,
        'X-App-Access-Sig': signature,
      },
      body: payload || undefined,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new AppError('service_unavailable', { details: { provider: 'sumsub', status: res.status } });
    return res.json();
  }

  return {
    name: 'sumsub',
    async startVerification({ userId, locale }) {
      const query = new URLSearchParams({ ttlInSecs: '1800', externalUserId: userId, lang: locale || 'en' });
      const data = await signedRequest('POST', `/resources/sdkIntegrations/levels/${encodeURIComponent(cfg.levelName)}/websdkLink?${query}`);
      return { mode: 'hosted', url: data.url, providerReference: userId };
    },
    verifyWebhook(rawBody, headers) {
      const alg = String(headers['x-payload-digest-alg'] || 'HMAC_SHA256_HEX').toUpperCase();
      const map = { HMAC_SHA1_HEX: 'sha1', HMAC_SHA256_HEX: 'sha256', HMAC_SHA512_HEX: 'sha512' };
      if (!map[alg]) return false;
      const expected = crypto.createHmac(map[alg], cfg.webhookSecret).update(rawBody).digest('hex');
      return timingSafeEqualString(expected, headers['x-payload-digest'] || '');
    },
    parseWebhook(body) {
      if (body?.type !== 'applicantReviewed' || !body.externalUserId) return null;
      const answer = body.reviewResult?.reviewAnswer;
      return {
        userId: body.externalUserId,
        providerReference: body.applicantId || body.externalUserId,
        status: answer === 'GREEN' ? 'approved' : 'rejected',
        reason: (body.reviewResult?.rejectLabels || []).join(',') || null,
        final: body.reviewResult?.reviewRejectType !== 'RETRY',
      };
    },
  };
}

export function createManualKycProvider() {
  return {
    name: 'manual',
    async startVerification({ userId }) {
      return { mode: 'manual', url: null, providerReference: `manual:${userId}` };
    },
    verifyWebhook() {
      return false;
    },
    parseWebhook() {
      return null;
    },
  };
}

let provider;
export function getKycProvider() {
  if (!provider) {
    const config = getConfig();
    provider = config.kyc.provider === 'sumsub' ? createSumsubProvider(config.kyc.sumsub) : createManualKycProvider();
  }
  return provider;
}
export function setKycProvider(p) {
  provider = p;
}
