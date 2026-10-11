import { Router } from 'express';
import { AppError } from '../../core/errors.js';
import { sendData } from '../../core/respond.js';
import { requireCronSecret } from '../../middleware/require-cron-secret.js';
import { JOB_GROUPS, JOBS, runGroup, runJob } from './jobs.service.js';

// Vercel Cron calls these with GET + "Authorization: Bearer <CRON_SECRET>".
export function jobsRoutes() {
  const r = Router();
  r.use(requireCronSecret());
  r.get('/group/:group', async (req, res) => {
    if (!JOB_GROUPS[req.params.group]) throw new AppError('not_found');
    sendData(res, await runGroup(req.params.group));
  });
  r.get('/:name', async (req, res) => {
    if (!JOBS[req.params.name]) throw new AppError('not_found');
    sendData(res, await runJob(req.params.name));
  });
  return r;
}
