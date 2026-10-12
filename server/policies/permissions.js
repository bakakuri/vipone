// Role-based access control for staff. Regular users have no staff role and
// can only act on their own data (enforced in every repository query by
// user_id and, as a second layer, by Row Level Security).

export const STAFF_ROLES = ['support', 'finance', 'compliance', 'super_admin'];

const ALL_STAFF = STAFF_ROLES;

export const PERMISSIONS = Object.freeze({
  'admin.access': ALL_STAFF,
  'dashboard.read': ALL_STAFF,
  'users.read': ALL_STAFF,
  'users.restrict': ['compliance', 'super_admin'],
  'users.roles.manage': ['super_admin'],
  'kyc.review': ['compliance', 'super_admin'],
  'risk.manage': ['compliance', 'super_admin'],
  'deposits.read': ALL_STAFF,
  'deposits.review': ['compliance', 'super_admin'],
  'deposits.return': ['finance', 'super_admin'],
  'addresses.manage': ['finance', 'super_admin'],
  'deposit_methods.manage': ['finance', 'super_admin'],
  'withdrawals.read': ALL_STAFF,
  'withdrawals.review': ['finance', 'compliance', 'super_admin'],
  'withdrawals.approve': ['finance', 'super_admin'],
  'withdrawals.process': ['finance', 'super_admin'],
  'investments.read': ALL_STAFF,
  'investments.products.manage': ['super_admin'],
  'investments.results.create': ['finance', 'super_admin'],
  'investments.results.approve': ['finance', 'super_admin'],
  'referrals.read': ALL_STAFF,
  'referrals.review': ['compliance', 'finance', 'super_admin'],
  'settings.read': ['finance', 'compliance', 'super_admin'],
  'settings.request': ['finance', 'compliance', 'super_admin'],
  'approvals.read': ['finance', 'compliance', 'super_admin'],
  'approvals.decide': ['finance', 'compliance', 'super_admin'],
  'treasury.manage': ['finance', 'super_admin'],
  'reconciliation.run': ['finance', 'super_admin'],
  'audit.read': ['compliance', 'super_admin'],
  'support.manage': ['support', 'compliance', 'super_admin'],
  'announcements.manage': ['support', 'super_admin'],
  'demo.tools': ['super_admin', 'finance'],
});

export function hasPermission(roles, permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) throw new Error(`Unknown permission ${permission}`);
  return roles.some((r) => allowed.includes(r));
}

export function permissionsFor(roles) {
  return Object.keys(PERMISSIONS).filter((p) => hasPermission(roles, p));
}

// Approval rules for four-eyes requests: who may approve which action.
export const APPROVAL_RULES = Object.freeze({
  'settings.update': ['super_admin'],
  'fee_rule.create': ['super_admin'],
  'ledger.adjustment': ['super_admin', 'finance'],
  'role.grant': ['super_admin'],
  'role.revoke': ['super_admin'],
  'user.reinstate': ['super_admin', 'compliance'],
});
