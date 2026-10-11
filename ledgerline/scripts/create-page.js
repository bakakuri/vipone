// Scaffolds a new page: public/pages/<name>.html, public/js/pages/<name>.js
// and public/css/pages/<name>.css. Add the route to server/config/site-routes.js
// afterwards (the build, dev server, sitemap and vercel.json read it).
//   node scripts/create-page.js reports --area app --title "reports:title"

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageHtml } from './lib/page-html.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [name, ...rest] = process.argv.slice(2);
if (!name || !/^[a-z0-9/-]+$/.test(name)) {
  console.error('usage: node scripts/create-page.js <name> [--area public|auth|app|admin] [--title ns:key]');
  process.exit(1);
}
const arg = (flag, fallback) => {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : fallback;
};
const area = arg('--area', 'app');
const titleKey = arg('--title', `${name.split('/').pop()}:title`);
const depth = name.split('/').length;
const up = '../'.repeat(depth);

const files = {
  [`public/pages/${name}.html`]: pageHtml({ page: name, area, titleKey, title: name }),
  [`public/js/pages/${name}.js`]: `import { definePage } from '${up}core/page.js';
import { replace, h } from '${up}core/dom.js';
import { t } from '${up}i18n/i18n.js';

definePage({
  id: '${name.replace(/\//g, '-')}',
  area: '${area}',
  namespaces: ['${titleKey.split(':')[0]}'],
  title: '${titleKey}',
  async render({ page }) {
    replace(page, h('h1', {}, t('${titleKey}')));
  },
});
`,
  [`public/css/pages/${name}.css`]: `/* Styles used only by the ${name} page. */\n`,
};
for (const [file, content] of Object.entries(files)) {
  const full = path.join(root, file);
  if (existsSync(full)) {
    console.error(`exists: ${file}`);
    process.exit(1);
  }
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  console.log(`created ${file}`);
}
