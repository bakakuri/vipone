// Pre-rendering of public pages in every language for search engines and
// for visitors without JavaScript. Works on the page HTML as text: elements
// marked data-i18n contain plain text only (no nested markup), which a test
// enforces, so a targeted replacement is safe.

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPE[c]);

export function lookup(messages, fullKey) {
  const ns = fullKey.slice(0, fullKey.indexOf(':'));
  const path = fullKey.slice(ns.length + 1);
  const value = path.split('.').reduce((acc, p) => (acc && typeof acc === 'object' ? acc[p] : undefined), messages[ns]);
  return typeof value === 'string' ? value : undefined;
}

function translate(messages, fallback, key) {
  return lookup(messages, key) ?? lookup(fallback, key);
}

/**
 * @param {string} html       source page (English text inline)
 * @param {object} opts
 *   locale, dir, messages (namespace -> object), fallback (English messages),
 *   canonical (absolute URL of this version), alternates [{locale, href}]
 */
export function localizeHtml(html, { locale, dir, messages, fallback, canonical, alternates = [], siteName = 'Ledgerline' }) {
  let out = html;
  // Text content of marked elements.
  out = out.replace(/(<([a-z0-9]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, key, text, close) => {
    const value = translate(messages, fallback, key);
    return value === undefined ? m : `${open}${escapeHtml(value)}${close}`;
  });
  // Translated attributes (e.g. meta description).
  out = out.replace(/<[a-z0-9]+\b[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g, (tag, spec) => {
    let result = tag;
    for (const pair of spec.split('|')) {
      const idx = pair.indexOf(':');
      const attr = pair.slice(0, idx);
      const value = translate(messages, fallback, pair.slice(idx + 1));
      if (value === undefined) continue;
      result = result.replace(new RegExp(`(\\s${attr}=")[^"]*(")`), `$1${escapeHtml(value)}$2`);
    }
    return result;
  });
  // Document language, direction and title.
  out = out.replace(/<html lang="[^"]*" dir="[^"]*"/, `<html lang="${locale}" dir="${dir}"`);
  const titleKey = /data-title-key="([^"]+)"/.exec(out)?.[1];
  if (titleKey) {
    const title = translate(messages, fallback, titleKey);
    if (title) out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)} · ${escapeHtml(siteName)}</title>`);
  }
  // Canonical URL and language alternates.
  if (canonical) {
    const links = [`<link rel="canonical" href="${escapeHtml(canonical)}">`,
      ...alternates.map((a) => `<link rel="alternate" hreflang="${a.locale}" href="${escapeHtml(a.href)}">`),
      alternates[0] ? `<link rel="alternate" hreflang="x-default" href="${escapeHtml(alternates[0].href)}">` : ''];
    out = out.replace('</head>', `  ${links.filter(Boolean).join('\n  ')}\n</head>`);
  }
  return out;
}

// Inlines @import url('./x.css') recursively into one stylesheet.
export async function flattenCss(entry, readFile, path) {
  const seen = new Set();
  async function load(file) {
    if (seen.has(file)) return '';
    seen.add(file);
    const css = await readFile(file, 'utf8');
    const parts = [];
    let last = 0;
    for (const m of css.matchAll(/@import\s+url\(['"]?([^'")]+)['"]?\);?/g)) {
      parts.push(css.slice(last, m.index));
      parts.push(await load(path.resolve(path.dirname(file), m[1])));
      last = m.index + m[0].length;
    }
    parts.push(css.slice(last));
    return parts.join('');
  }
  return load(entry);
}

export function sitemapXml(routes, { baseUrl, locales, defaultLocale, localizedPath, lastmod }) {
  const urls = [];
  for (const route of routes.filter((r) => r.sitemap)) {
    const variants = route.localized ? locales : [defaultLocale];
    for (const locale of variants) {
      const loc = `${baseUrl}${localizedPath(route, locale)}`;
      const alternates = route.localized
        ? locales.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeHtml(`${baseUrl}${localizedPath(route, l)}`)}"/>`).join('\n')
        : '';
      urls.push(`  <url>\n    <loc>${escapeHtml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>${route.priority ?? '0.5'}</priority>${alternates ? `\n${alternates}` : ''}\n  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

export function robotsTxt(routes, { baseUrl }) {
  const privatePaths = routes.filter((r) => r.access === 'user' || r.access === 'admin' || r.access === 'guest').map((r) => r.path);
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /api/', ...[...new Set(privatePaths)].sort().map((p) => `Disallow: ${p}`)];
  if (baseUrl) lines.push('', `Sitemap: ${baseUrl}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}
