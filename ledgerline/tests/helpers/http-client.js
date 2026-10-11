// Minimal browser-like HTTP client for tests: keeps cookies, sends the
// Origin header and the double-submit CSRF header, like the real frontend.

import crypto from 'node:crypto';

export class HttpClient {
  constructor(baseUrl, origin) {
    this.baseUrl = baseUrl;
    this.origin = origin;
    this.cookies = new Map();
  }

  storeCookies(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const expired = attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a) || /max-age=0/i.test(a.trim()));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, decodeURIComponent(value));
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
  }

  csrf() {
    for (const [k, v] of this.cookies) if (k.endsWith('ll_csrf')) return v;
    return null;
  }

  async request(method, path, { body, headers = {}, idempotencyKey, raw = false } = {}) {
    const h = { accept: 'application/json', origin: this.origin, ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (this.cookies.size) h.cookie = this.cookieHeader();
    const csrf = this.csrf();
    if (csrf && method !== 'GET') h['x-csrf-token'] = csrf;
    if (idempotencyKey) h['idempotency-key'] = idempotencyKey === true ? crypto.randomUUID() : idempotencyKey;
    const res = await fetch(this.baseUrl + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    this.storeCookies(res);
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { text };
    }
    return { status: res.status, body: json, headers: res.headers, data: json?.data, error: json?.error };
  }

  get(path, opts) {
    return this.request('GET', path, opts);
  }
  post(path, body, opts = {}) {
    return this.request('POST', path, { ...opts, body: body ?? {} });
  }
  patch(path, body, opts = {}) {
    return this.request('PATCH', path, { ...opts, body });
  }
  del(path, opts) {
    return this.request('DELETE', path, opts);
  }
}
