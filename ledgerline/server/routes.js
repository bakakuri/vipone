// /api/v1 route table.

import { Router } from 'express';
import { sendData } from './core/respond.js';
import { getSql } from './db/client.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { clientErrorsRoutes } from './modules/client-errors/client-errors.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { depositsRoutes } from './modules/deposits/deposits.routes.js';
import { earningsRoutes } from './modules/earnings/earnings.routes.js';
import { investmentsRoutes } from './modules/investments/investments.routes.js';
import { jobsRoutes } from './modules/jobs/jobs.routes.js';
import { liveRoutes } from './modules/live/live.routes.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import { profileRoutes } from './modules/profile/profile.routes.js';
import { publicRoutes } from './modules/public/public.routes.js';
import { referralsRoutes } from './modules/referrals/referrals.routes.js';
import { supportRoutes } from './modules/support/support.routes.js';
import { transactionsRoutes } from './modules/transactions/transactions.routes.js';
import { walletsRoutes } from './modules/wallets/wallets.routes.js';
import { webhooksRoutes } from './modules/webhooks/webhooks.routes.js';
import { withdrawalsRoutes } from './modules/withdrawals/withdrawals.routes.js';

export function apiRoutes() {
  const r = Router();

  r.get('/health', async (req, res) => {
    const started = Date.now();
    await getSql()`select 1`;
    sendData(res, { status: 'ok', database: 'ok', latencyMs: Date.now() - started });
  });

  r.use('/public', publicRoutes());
  r.use('/auth', authRoutes());
  r.use('/profile', profileRoutes());
  r.use('/dashboard', dashboardRoutes());
  r.use('/deposits', depositsRoutes());
  r.use('/wallets', walletsRoutes());
  r.use('/withdrawals', withdrawalsRoutes());
  r.use('/investments', investmentsRoutes());
  r.use('/earnings', earningsRoutes());
  r.use('/transactions', transactionsRoutes());
  r.use('/referrals', referralsRoutes());
  r.use('/notifications', notificationsRoutes());
  r.use('/support', supportRoutes());
  r.use('/live', liveRoutes());
  r.use('/client-errors', clientErrorsRoutes());
  r.use('/webhooks', webhooksRoutes());
  r.use('/jobs', jobsRoutes());
  r.use('/admin', adminRoutes());
  return r;
}
