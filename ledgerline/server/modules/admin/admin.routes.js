// /api/v1/admin — staff only. Every route below also checks its own
// fine-grained permission (server/policies/permissions.js).

import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { byUser, rateLimit } from '../../middleware/rate-limit.js';
import { adminAnnouncementsRoutes } from './announcements/admin-announcements.routes.js';
import { adminApprovalsRoutes } from './approvals/admin-approvals.routes.js';
import { adminAuditRoutes } from './audit/admin-audit.routes.js';
import { adminDashboardRoutes } from './dashboard/admin-dashboard.routes.js';
import { adminDemoRoutes } from './demo/admin-demo.routes.js';
import { adminDepositsRoutes } from './deposits/admin-deposits.routes.js';
import { adminInvestmentsRoutes } from './investments/admin-investments.routes.js';
import { adminReferralsRoutes } from './referrals/admin-referrals.routes.js';
import { adminSettingsRoutes } from './settings/admin-settings.routes.js';
import { adminSupportRoutes } from './support/admin-support.routes.js';
import { adminSystemRoutes } from './system/admin-system.routes.js';
import { adminTreasuryRoutes } from './treasury/admin-treasury.routes.js';
import { adminUsersRoutes } from './users/admin-users.routes.js';
import { adminWithdrawalsRoutes } from './withdrawals/admin-withdrawals.routes.js';

export function adminRoutes() {
  const r = Router();
  r.use(authenticate(), requirePermission('admin.access'), rateLimit({ name: 'admin', max: 600, windowSeconds: 60, key: byUser }));
  r.use('/dashboard', adminDashboardRoutes());
  r.use('/users', adminUsersRoutes());
  r.use('/deposits', adminDepositsRoutes());
  r.use('/withdrawals', adminWithdrawalsRoutes());
  r.use('/investments', adminInvestmentsRoutes());
  r.use('/referrals', adminReferralsRoutes());
  r.use('/settings', adminSettingsRoutes());
  r.use('/approvals', adminApprovalsRoutes());
  r.use('/treasury', adminTreasuryRoutes());
  r.use('/audit', adminAuditRoutes());
  r.use('/support', adminSupportRoutes());
  r.use('/announcements', adminAnnouncementsRoutes());
  r.use('/system', adminSystemRoutes());
  r.use('/demo', adminDemoRoutes());
  return r;
}
