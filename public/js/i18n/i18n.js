// Translation runtime. Keys are "namespace:path.to.key"; texts live in
// /locales/<lang>/<namespace>.json. Missing keys fall back to English and are
// reported in development. Plural forms use Intl.PluralRules (Russian has
// one/few/many/other, Arabic has six forms).

import { emit } from '../core/events.js';
import { setPref } from '../core/storage.js';
import { detectLocale } from './detect-locale.js';
import { DEFAULT_LOCALE, LOCALES, SUPPORTED } from './locales.js';

const cache = new Map(); // `${locale}:${ns}` -> object
const loaded = new Set(['common', 'navigation', 'errors']);
let current = DEFAULT_LOCALE;
const DEV = ['localhost', '127.0.0.1'].includes(location.hostname);

async function loadNamespace(locale, ns) {
  const key = `${locale}:${ns}`;
  if (cache.has(key)) return cache.get(key);
  const promise = fetch(`/locales/${locale}/${ns}.json`, { credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  cache.set(key, promise);
  const data = await promise;
  cache.set(key, data);
  return data;
}

async function loadAll(locale, namespaces) {
  const list = [...new Set([...namespaces, ...loaded])];
  await Promise.all(list.flatMap((ns) => [loadNamespace(locale, ns), locale === DEFAULT_LOCALE ? null : loadNamespace(DEFAULT_LOCALE, ns)]));
}

function lookup(locale, ns, path) {
  const data = cache.get(`${locale}:${ns}`);
  if (!data || data instanceof Promise) return undefined;
  return path.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), data);
}

function interpolate(text, params) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => (params && params[name] !== undefined && params[name] !== null ? String(params[name]) : ''));
}

export function getLocale() {
  return current;
}

export function formatLocale() {
  return LOCALES[current].format;
}

export function t(fullKey, params = {}) {
  const idx = fullKey.indexOf(':');
  const ns = idx > 0 ? fullKey.slice(0, idx) : 'common';
  const path = idx > 0 ? fullKey.slice(idx + 1) : fullKey;
  let value = lookup(current, ns, path);
  if (value === undefined && current !== DEFAULT_LOCALE) {
    value = lookup(DEFAULT_LOCALE, ns, path);
    if (DEV && value !== undefined) console.warn(`[i18n] missing ${current} translation: ${fullKey}`);
  }
  if (value && typeof value === 'object' && params.count !== undefined) {
    const form = new Intl.PluralRules(LOCALES[current].format).select(Number(params.count));
    value = value[form] ?? value.other;
  }
  if (typeof value !== 'string') {
    if (DEV) console.warn(`[i18n] missing key: ${fullKey}`);
    return path.split('.').pop();
  }
  return interpolate(value, params);
}

// Raw value (arrays/objects of texts, e.g. help topics), with English fallback.
export function raw(fullKey) {
  const idx = fullKey.indexOf(':');
  const ns = idx > 0 ? fullKey.slice(0, idx) : 'common';
  const path = idx > 0 ? fullKey.slice(idx + 1) : fullKey;
  return lookup(current, ns, path) ?? lookup(DEFAULT_LOCALE, ns, path);
}

export function has(fullKey) {
  const idx = fullKey.indexOf(':');
  const ns = idx > 0 ? fullKey.slice(0, idx) : 'common';
  const path = idx > 0 ? fullKey.slice(idx + 1) : fullKey;
  return lookup(current, ns, path) !== undefined || lookup(DEFAULT_LOCALE, ns, path) !== undefined;
}

// Picks the right language from a {en, ru, ar} object (product texts, announcements).
export function localized(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return obj[current] || obj[DEFAULT_LOCALE] || Object.values(obj)[0] || '';
}

function applyDocumentLanguage(locale) {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = LOCALES[locale].dir;
}

export async function initI18n(namespaces = []) {
  current = detectLocale();
  namespaces.forEach((ns) => loaded.add(ns));
  applyDocumentLanguage(current);
  await loadAll(current, [...loaded]);
}

export async function loadNamespaces(namespaces) {
  namespaces.forEach((ns) => loaded.add(ns));
  await loadAll(current, namespaces);
}

export async function setLocale(locale) {
  if (!SUPPORTED.includes(locale) || locale === current) return;
  await loadAll(locale, [...loaded]);
  current = locale;
  setPref('locale', locale);
  applyDocumentLanguage(locale);
  emit('locale:changed', { locale });
}
