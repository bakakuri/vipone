// Wallet screening (sanctions / illicit-funds exposure).
//   SCREENING_PROVIDER=none  development only; every address is "unknown"
//   SCREENING_PROVIDER=http  POST {network, address, direction} to SCREENING_API_URL
//                            with a bearer key; expects {"risk": "low|medium|high|severe", "reference": "..."}
// Wrap a vendor such as Chainalysis, TRM or Elliptic behind that small HTTP
// contract (or replace this module). The internal denylist (app.address_denylist)
// always applies in addition.

import { getConfig } from '../../config/env.js';
import { logger } from '../../core/logger.js';

export function createScreeningProvider(config, { fetchImpl = fetch } = {}) {
  if (config.screening.provider === 'http') {
    return {
      name: 'http',
      async screenAddress({ network, address, direction }) {
        try {
          const res = await fetchImpl(config.screening.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${config.screening.apiKey}` },
            body: JSON.stringify({ network, address, direction }),
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) throw new Error(`screening responded ${res.status}`);
          const body = await res.json();
          const risk = String(body.risk || '').toLowerCase();
          return { result: risk === 'high' || risk === 'severe' ? 'flagged' : risk ? 'clear' : 'unknown', reference: body.reference || null };
        } catch (err) {
          // Fail closed: an unscreened incoming deposit goes to manual review.
          logger.warn('screening failed', { error: err.message });
          return { result: 'unknown', reference: null, error: true };
        }
      },
    };
  }
  return {
    name: 'none',
    async screenAddress() {
      return { result: 'unknown', reference: null };
    },
  };
}

let provider;
export function getScreeningProvider() {
  if (!provider) provider = createScreeningProvider(getConfig());
  return provider;
}
export function setScreeningProvider(p) {
  provider = p;
}
