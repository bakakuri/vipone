// Server-side access to the same translation files the browser uses
// (public/locales). Used for emails. On Vercel these files are bundled with
// the function through `includeFiles` in vercel.json.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/locales');
export const SUPPORTED_LOCALES = ['en', 'ru', 'ar', 'ka'];
const cache = new Map();

export function loadNamespace(locale, namespace) {
  const lng = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';
  const key = `${lng}:${namespace}`;
  if (!cache.has(key)) {
    cache.set(key, JSON.parse(readFileSync(path.join(LOCALES_DIR, lng, `${namespace}.json`), 'utf8')));
  }
  return cache.get(key);
}

function lookup(obj, dotted) {
  return dotted.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);
}

export function interpolate(template, params = {}) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => (params[name] ?? '').toString());
}

export function translate(locale, namespace, key, params) {
  const value = lookup(loadNamespace(locale, namespace), key) ?? lookup(loadNamespace('en', namespace), key);
  if (typeof value !== 'string') return key;
  return interpolate(value, params);
}
