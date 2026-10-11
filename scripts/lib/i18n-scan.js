// Finds translation keys used by the front end:
//   - literal keys in JavaScript: t('ns:key'), raw('ns:key'), has('ns:key')
//   - dynamic key families: t(`ns:prefix.${...}`) -> reported as prefixes
//   - static markup: data-i18n="ns:key" and data-i18n-attr="attr:ns:key|..."
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, ext, out);
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

export function scanJs(files) {
  const literal = new Map();
  const dynamic = new Map();
  const re = /\b(?:t|raw|has)\(\s*(['"`])((?:(?!\1).)+?)\1/g;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) {
      const key = m[2];
      if (!/^[a-z][a-zA-Z]*:/.test(key)) continue;
      if (m[1] === '`' && key.includes('${')) {
        const prefix = key.slice(0, key.indexOf('${'));
        if (!dynamic.has(prefix)) dynamic.set(prefix, new Set());
        dynamic.get(prefix).add(path.relative(process.cwd(), file));
      } else {
        if (!literal.has(key)) literal.set(key, new Set());
        literal.get(key).add(path.relative(process.cwd(), file));
      }
    }
  }
  return { literal, dynamic };
}

// Returns [{ key, text, attr? }] in document order.
export function scanHtml(files) {
  const found = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
      found.push({ key: m[2], text: decode(m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()), file });
    }
    for (const m of src.matchAll(/<[^>]*\scontent="([^"]*)"[^>]*data-i18n-attr="content:([^"|]+)"[^>]*>/g)) {
      found.push({ key: m[2], text: decode(m[1]), file, attr: 'content' });
    }
    for (const m of src.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of m[1].split('|')) {
        const key = pair.slice(pair.indexOf(':') + 1);
        if (!found.some((f) => f.key === key)) found.push({ key, text: null, file, attr: pair.split(':')[0] });
      }
    }
  }
  return found;
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !isPlural(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

export function isPlural(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && 'other' in v && Object.keys(v).every((k) => ['zero', 'one', 'two', 'few', 'many', 'other'].includes(k));
}

export function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts.at(-1)] = value;
}
