// Copies the English text of the public pages (the HTML is the source of the
// English wording) into public/locales/en/<namespace>.json, so the build can
// pre-render /ru and /ar from the matching keys. Run after editing public
// page text, then translate the new keys in ru/ and ar/.
//   node scripts/extract-public-text.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanHtml, setPath, walk } from './lib/i18n-scan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNED = ['home', 'public', 'legal'];
const found = scanHtml(walk(path.join(root, 'public/pages'), '.html')).filter((f) => f.text !== null);
const byNs = new Map();
for (const f of found) {
  const [ns, key] = [f.key.slice(0, f.key.indexOf(':')), f.key.slice(f.key.indexOf(':') + 1)];
  if (!OWNED.includes(ns)) continue;
  if (!byNs.has(ns)) byNs.set(ns, []);
  byNs.get(ns).push([key, f.text, f.file]);
}
for (const [ns, entries] of byNs) {
  const file = path.join(root, 'public/locales/en', `${ns}.json`);
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  for (const [key, text, src] of entries) {
    const current = key.split('.').reduce((a, p) => (a ? a[p] : undefined), data);
    if (current !== undefined && current !== text) console.warn(`updated ${ns}:${key} (from ${path.relative(root, src)})`);
    setPath(data, key, text);
  }
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${ns}: ${entries.length} strings`);
}
