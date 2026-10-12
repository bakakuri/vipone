// Translation checks (run in CI and by `npm run check:i18n`):
//   1. every literal key used in JS/HTML exists in English
//   2. every dynamic key family (t(`ns:prefix.${x}`)) exists in English
//   3. ru, ar and ka have exactly the same keys as en, with the same
//      {{placeholders}} and the same array/object shapes
//   4. the English text in public HTML equals locales/en (no drift)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flatten, isPlural, scanHtml, scanJs, walk } from './lib/i18n-scan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'ru', 'ar', 'ka'];
const IGNORE_LITERALS = new Set(['auth:required', 'notifications:read']); // event names, not keys

export function loadLocale(locale) {
  const dir = path.join(root, 'public/locales', locale);
  const out = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    out[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  }
  return out;
}

function lookup(data, fullKey) {
  const ns = fullKey.slice(0, fullKey.indexOf(':'));
  const p = fullKey.slice(ns.length + 1);
  return p.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), data[ns]);
}

const placeholders = (v) => JSON.stringify(v).match(/\{\{\s*\w+\s*\}\}/g)?.map((s) => s.replace(/\s/g, '')).sort().join(',') ?? '';

function shape(value, prefix, out) {
  if (Array.isArray(value)) {
    out.set(prefix, `array:${value.length}`);
    value.forEach((v, i) => shape(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === 'object' && !isPlural(value)) {
    for (const [k, v] of Object.entries(value)) shape(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, isPlural(value) ? 'plural' : typeof value);
  }
  return out;
}

export function checkI18n() {
  const errors = [];
  const warnings = [];
  const data = Object.fromEntries(LOCALES.map((l) => [l, loadLocale(l)]));
  const js = scanJs(walk(path.join(root, 'public/js'), '.js'));
  const htmlFiles = walk(path.join(root, 'public/pages'), '.html');
  const html = scanHtml(htmlFiles);
  const titleKeys = htmlFiles.map((f) => /data-title-key="([^"]+)"/.exec(readFileSync(f, 'utf8'))?.[1]).filter(Boolean);

  // Keys kept in data structures (navigation items, balance segments…).
  const quoted = new Set();
  const namespaces = Object.keys(data.en).join('|');
  for (const file of walk(path.join(root, 'public/js'), '.js')) {
    for (const m of readFileSync(file, 'utf8').matchAll(new RegExp(`'((?:${namespaces}):[a-zA-Z0-9_.]+)'`, 'g'))) quoted.add(m[1]);
  }
  for (const key of new Set([...js.literal.keys(), ...html.map((x) => x.key), ...titleKeys, ...quoted])) {
    if (IGNORE_LITERALS.has(key)) continue;
    if (lookup(data.en, key) === undefined) errors.push(`missing en key: ${key}`);
  }
  for (const prefix of js.dynamic.keys()) {
    const base = prefix.replace(/\.$/, '');
    const value = lookup(data.en, base);
    if (!value || typeof value !== 'object') errors.push(`missing en key family: ${prefix}*`);
  }
  for (const item of html) {
    if (item.text === null) continue;
    const ns = item.key.slice(0, item.key.indexOf(':'));
    if (!['home', 'public', 'legal'].includes(ns)) continue;
    const en = lookup(data.en, item.key);
    if (typeof en === 'string' && en !== item.text) errors.push(`HTML text differs from en for ${item.key} (run scripts/extract-public-text.js)`);
  }

  for (const locale of LOCALES.filter((l) => l !== 'en')) {
    for (const ns of Object.keys(data.en)) {
      if (!data[locale][ns]) {
        errors.push(`${locale}: missing namespace ${ns}`);
        continue;
      }
      const enShape = shape(data.en[ns], '', new Map());
      const otherShape = shape(data[locale][ns], '', new Map());
      for (const [k, kind] of enShape) {
        if (!otherShape.has(k)) errors.push(`${locale}: missing ${ns}:${k}`);
        else if (otherShape.get(k) !== kind) errors.push(`${locale}: ${ns}:${k} is ${otherShape.get(k)}, en is ${kind}`);
      }
      for (const k of otherShape.keys()) if (!enShape.has(k)) warnings.push(`${locale}: extra ${ns}:${k}`);
      const enFlat = flatten(data.en[ns]);
      const otherFlat = flatten(data[locale][ns]);
      for (const [k, v] of Object.entries(enFlat)) {
        if (otherFlat[k] !== undefined && placeholders(v) !== placeholders(otherFlat[k]) && !isPlural(v)) {
          errors.push(`${locale}: placeholders differ in ${ns}:${k} (${placeholders(v)} vs ${placeholders(otherFlat[k])})`);
        }
      }
    }
  }
  return { errors, warnings, dynamic: [...js.dynamic.keys()] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, warnings } = checkI18n();
  warnings.forEach((w) => console.warn(`warn  ${w}`));
  errors.forEach((e) => console.error(`error ${e}`));
  console.log(errors.length ? `${errors.length} translation problem(s)` : 'translations OK');
  process.exit(errors.length ? 1 : 0);
}
