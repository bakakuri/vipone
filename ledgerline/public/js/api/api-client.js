// Fetch wrapper for the Ledgerline API.
// - cookies carry the session (HttpOnly; JavaScript never sees the tokens)
// - the CSRF cookie is echoed in X-CSRF-Token on state-changing requests
// - an expired access token triggers one refresh, then the request is retried
// - errors become ApiError with a stable code the UI translates

import { emit } from '../core/events.js';

export class ApiError extends Error {
  constructor({ status, code, details, requestId }) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

let lastServerTime = null;
let refreshing = null;

// Requests cut off because the page is navigating away are not failures the
// person needs to see: they surface as AbortError, which callers ignore.
let unloading = false;
addEventListener('pagehide', () => {
  unloading = true;
});
addEventListener('pageshow', () => {
  unloading = false;
});
addEventListener('beforeunload', () => {
  unloading = true;
  // A cancelled navigation leaves the page alive; stop treating it as leaving.
  setTimeout(() => {
    unloading = false;
  }, 10000);
});

export function serverTime() {
  return lastServerTime;
}

function csrfToken() {
  const match = document.cookie.split('; ').find((c) => c.startsWith('__Host-ll_csrf=') || c.startsWith('ll_csrf='));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

function buildUrl(path, query) {
  const url = new URL(`/api/v1${path}`, location.origin);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  return url;
}

async function refreshSession() {
  if (!refreshing) {
    refreshing = rawRequest('POST', '/auth/refresh', { retry: false })
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => {
          refreshing = null;
        }, 0);
      });
  }
  return refreshing;
}

async function rawRequest(method, path, { body, query, idempotencyKey, signal, retry = true, raw = false } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = csrfToken();
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    if (unloading) throw new DOMException('Page is unloading', 'AbortError');
    throw new ApiError({ status: 0, code: navigator.onLine ? 'network_error' : 'offline' });
  }

  if (raw && res.ok) return res;
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (payload?.meta?.serverTime) {
    lastServerTime = payload.meta.serverTime;
    emit('server:time', lastServerTime);
  }

  if (res.ok) return payload?.data ?? payload;

  const error = payload?.error || {};
  const apiError = new ApiError({ status: res.status, code: error.code || `http_${res.status}`, details: error.details, requestId: error.requestId });
  if (res.status === 401 && retry && (apiError.code === 'token_expired' || apiError.code === 'unauthenticated') && path !== '/auth/refresh') {
    if (await refreshSession()) return rawRequest(method, path, { body, query, idempotencyKey, signal, retry: false, raw });
  }
  if (res.status === 401) emit('auth:required', apiError);
  if (res.status === 403 && apiError.code === 'mfa_required') emit('auth:mfa-required', apiError);
  throw apiError;
}

export const api = {
  get: (path, query, opts) => rawRequest('GET', path, { ...opts, query }),
  post: (path, body = {}, opts) => rawRequest('POST', path, { ...opts, body }),
  patch: (path, body = {}, opts) => rawRequest('PATCH', path, { ...opts, body }),
  del: (path, opts) => rawRequest('DELETE', path, opts),
  download: (path, query) => rawRequest('GET', path, { query, raw: true }),
};
