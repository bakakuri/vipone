// Navigation structure (user and admin). Labels are translation keys.
export const USER_NAV = {
  main: [
    { href: '/dashboard', icon: 'dashboard', label: 'navigation:dashboard', tour: 'dashboard' },
    { href: '/deposit', icon: 'deposit', label: 'navigation:deposit', tour: 'deposit' },
    { href: '/investments', icon: 'layers', label: 'navigation:investments', tour: 'investments' },
    { href: '/earnings', icon: 'earnings', label: 'navigation:earnings', tour: 'earnings' },
    { href: '/withdrawals', icon: 'withdraw', label: 'navigation:withdrawals', tour: 'withdrawals' },
    { href: '/wallets', icon: 'wallet', label: 'navigation:wallets', tour: 'wallets' },
    { href: '/transactions', icon: 'ledger', label: 'navigation:transactions', tour: 'transactions' },
    { href: '/referrals', icon: 'referrals', label: 'navigation:referrals', tour: 'referrals' },
  ],
  account: [
    { href: '/notifications', icon: 'bell', label: 'navigation:notifications' },
    { href: '/profile', icon: 'user', label: 'navigation:profile' },
    { href: '/security', icon: 'shield', label: 'navigation:security', tour: 'security' },
    { href: '/support', icon: 'support', label: 'navigation:support' },
    { href: '/help', icon: 'help', label: 'navigation:help', tour: 'help' },
  ],
};

export const MOBILE_NAV = ['/dashboard', '/deposit', '/investments', '/withdrawals'];

export const ADMIN_NAV = [
  { href: '/admin', icon: 'gauge', label: 'admin:nav.overview', permission: 'dashboard.read' },
  { href: '/admin/users', icon: 'users', label: 'admin:nav.users', permission: 'users.read' },
  { href: '/admin/deposits', icon: 'deposit', label: 'admin:nav.deposits', permission: 'deposits.read' },
  { href: '/admin/withdrawals', icon: 'withdraw', label: 'admin:nav.withdrawals', permission: 'withdrawals.read' },
  { href: '/admin/investments', icon: 'layers', label: 'admin:nav.investments', permission: 'investments.read' },
  { href: '/admin/referrals', icon: 'referrals', label: 'admin:nav.referrals', permission: 'referrals.read' },
  { href: '/admin/treasury', icon: 'scale', label: 'admin:nav.treasury', permission: 'treasury.manage' },
  { href: '/admin/approvals', icon: 'check-list', label: 'admin:nav.approvals', permission: 'approvals.read' },
  { href: '/admin/settings', icon: 'settings', label: 'admin:nav.settings', permission: 'settings.read' },
  { href: '/admin/support', icon: 'support', label: 'admin:nav.support', permission: 'support.manage' },
  { href: '/admin/announcements', icon: 'megaphone', label: 'admin:nav.announcements', permission: 'announcements.manage' },
  { href: '/admin/audit', icon: 'file', label: 'admin:nav.audit', permission: 'audit.read' },
  { href: '/admin/system', icon: 'activity', label: 'admin:nav.system', permission: 'dashboard.read' },
];

export const PUBLIC_NAV = [
  { href: '/how-it-works', label: 'navigation:howItWorks' },
  { href: '/products', label: 'navigation:products' },
  { href: '/risk-disclosure', label: 'navigation:risk' },
  { href: '/faq', label: 'navigation:faq' },
  { href: '/contact', label: 'navigation:contact' },
];

export function isCurrent(href) {
  const path = location.pathname.replace(/^\/(ru|ar)(?=\/|$)/, '') || '/';
  if (href === '/admin') return path === '/admin';
  return path === href || (href !== '/' && path.startsWith(`${href}/`));
}
