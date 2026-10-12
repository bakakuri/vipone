// HTML shell shared by every page. Pages contain no inline scripts or styles
// (CSP: script-src 'self'; style-src 'self'). The theme and text direction are
// applied before first paint by /js/core/boot-theme.js.

const SHELL_CLASS = { public: 'public-page', auth: 'auth-card', app: 'page-stack', admin: 'page-stack' };

const SKELETON = `
    <div class="skeleton skeleton--text skeleton--title" aria-hidden="true"></div>
    <div class="skeleton skeleton--block" aria-hidden="true"></div>
    <div class="skeleton skeleton--block" aria-hidden="true"></div>`;

export function pageHtml({ page, area, titleKey, title, description, descriptionKey, content, robots, localized = false }) {
  const indexable = area === 'public' && robots !== 'noindex';
  const metaDescription = description
    ? `\n  <meta name="description" content="${description}"${descriptionKey ? ` data-i18n-attr="content:${descriptionKey}"` : ''}>`
    : '';
  return `<!doctype html>
<html lang="en" dir="ltr" data-title-key="${titleKey}"${localized ? ' data-localized="true"' : ''}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title} · Ledgerline</title>${metaDescription}
  <meta name="robots" content="${indexable ? 'index, follow' : 'noindex, nofollow'}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#05070d">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/icons/app-icon-180.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="preload" href="/assets/fonts/IBMPlexSans-Regular.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/app.css">
  <link rel="stylesheet" href="/css/pages/${page}.css">
  <script src="/js/core/boot-theme.js"></script>
  <script type="module" src="/js/pages/${page}.js"></script>
</head>
<body class="area-${area}">
  <div class="aurora" aria-hidden="true"><span class="aurora__blob aurora__blob--1"></span><span class="aurora__blob aurora__blob--2"></span><span class="aurora__blob aurora__blob--3"></span><span class="aurora__grid"></span><span class="aurora__grain"></span><canvas class="aurora__particles"></canvas></div>
  <a class="skip-link" href="#main" data-i18n="common:a11y.skipToContent">Skip to content</a>
  <main id="main" tabindex="-1">
    <div id="page" class="${SHELL_CLASS[area]}">${content ?? SKELETON}
    </div>
  </main>
  <noscript><p class="noscript" data-i18n="common:noscript">Ledgerline needs JavaScript for your account pages. Public information pages work without it.</p></noscript>
</body>
</html>
`;
}
