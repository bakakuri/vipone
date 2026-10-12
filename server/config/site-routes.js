// Single source of truth for page URLs. Used by the local dev server,
// scripts/generate-vercel-config.js (rewrites), scripts/build.js (localized
// pages, sitemap.xml) and the sitemap page.
//
// access: public | guest (only signed-out users) | user | admin
// localized: pre-rendered in /ru, /ar and /ka for search engines (public pages)

export const SITE_ROUTES = [
  { path: '/', page: 'home', access: 'public', sitemap: true, localized: true, priority: '1.0' },
  { path: '/how-it-works', page: 'how-it-works', access: 'public', sitemap: true, localized: true, priority: '0.8' },
  { path: '/products', page: 'products', access: 'public', sitemap: true, localized: true, priority: '0.8' },
  { path: '/risk-disclosure', page: 'risk-disclosure', access: 'public', sitemap: true, localized: true, priority: '0.7' },
  { path: '/faq', page: 'faq', access: 'public', sitemap: true, localized: true, priority: '0.6' },
  { path: '/contact', page: 'contact', access: 'public', sitemap: true, localized: true, priority: '0.5' },
  { path: '/sitemap', page: 'sitemap', access: 'public', sitemap: true, localized: true, priority: '0.3' },
  { path: '/legal/terms', page: 'legal/terms', access: 'public', sitemap: true, localized: true, priority: '0.3' },
  { path: '/legal/privacy', page: 'legal/privacy', access: 'public', sitemap: true, localized: true, priority: '0.3' },
  { path: '/legal/cookies', page: 'legal/cookies', access: 'public', sitemap: true, localized: true, priority: '0.3' },

  { path: '/login', page: 'login', access: 'guest' },
  { path: '/register', page: 'register', access: 'guest' },
  { path: '/forgot-password', page: 'forgot-password', access: 'guest' },
  { path: '/reset-password', page: 'reset-password', access: 'public' },
  { path: '/verify-email', page: 'verify-email', access: 'public' },

  { path: '/dashboard', page: 'dashboard', access: 'user', nav: 'main' },
  { path: '/deposit', page: 'deposit', access: 'user', nav: 'main' },
  { path: '/investments', page: 'investments', access: 'user', nav: 'main' },
  { path: '/earnings', page: 'earnings', access: 'user', nav: 'main' },
  { path: '/withdrawals', page: 'withdrawals', access: 'user', nav: 'main' },
  { path: '/wallets', page: 'wallets', access: 'user', nav: 'main' },
  { path: '/transactions', page: 'transactions', access: 'user', nav: 'main' },
  { path: '/referrals', page: 'referrals', access: 'user', nav: 'main' },
  { path: '/notifications', page: 'notifications', access: 'user', nav: 'account' },
  { path: '/profile', page: 'profile', access: 'user', nav: 'account' },
  { path: '/security', page: 'security', access: 'user', nav: 'account' },
  { path: '/support', page: 'support', access: 'user', nav: 'account' },
  { path: '/help', page: 'help', access: 'public', nav: 'account' },

  { path: '/admin', page: 'admin/dashboard', access: 'admin' },
  { path: '/admin/users', page: 'admin/users', access: 'admin' },
  { path: '/admin/user', page: 'admin/user', access: 'admin' },
  { path: '/admin/deposits', page: 'admin/deposits', access: 'admin' },
  { path: '/admin/withdrawals', page: 'admin/withdrawals', access: 'admin' },
  { path: '/admin/investments', page: 'admin/investments', access: 'admin' },
  { path: '/admin/referrals', page: 'admin/referrals', access: 'admin' },
  { path: '/admin/treasury', page: 'admin/treasury', access: 'admin' },
  { path: '/admin/approvals', page: 'admin/approvals', access: 'admin' },
  { path: '/admin/settings', page: 'admin/settings', access: 'admin' },
  { path: '/admin/support', page: 'admin/support', access: 'admin' },
  { path: '/admin/announcements', page: 'admin/announcements', access: 'admin' },
  { path: '/admin/audit', page: 'admin/audit', access: 'admin' },
  { path: '/admin/system', page: 'admin/system', access: 'admin' },
];

export const LOCALES = ['en', 'ru', 'ar', 'ka'];
export const DEFAULT_LOCALE = 'en';

export const pageFile = (route) => `/pages/${route.page}.html`;
export const localizedPath = (route, locale) =>
  locale === DEFAULT_LOCALE ? route.path : `/${locale}${route.path === '/' ? '' : route.path}`;
