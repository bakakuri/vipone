import { Router } from 'express';
import { z } from 'zod';
import { sendCreated, sendData } from '../../../core/respond.js';
import { requirePermission } from '../../../middleware/authenticate.js';
import { validate } from '../../../middleware/validate.js';
import { uuid } from '../../../utils/schemas.js';
import * as service from './admin-support.service.js';

const statuses = ['open', 'awaiting_user', 'resolved', 'closed'];

export function adminSupportRoutes() {
  const r = Router();
  r.use(requirePermission('support.manage'));
  r.get('/', validate({ query: z.object({ status: z.enum(statuses).optional() }) }), async (req, res) => {
    sendData(res, await service.listTickets(req.validQuery));
  });
  r.get('/:id', validate({ params: z.object({ id: uuid }) }), async (req, res) => {
    sendData(res, await service.getTicket(req.params.id));
  });
  r.post('/:id/messages', validate({ params: z.object({ id: uuid }), body: z.object({ body: z.string().trim().min(1).max(5000) }) }), async (req, res) => {
    sendCreated(res, await service.reply(req, req.params.id, req.body.body));
  });
  r.post('/:id/status', validate({ params: z.object({ id: uuid }), body: z.object({ status: z.enum(statuses) }) }), async (req, res) => {
    sendData(res, await service.setStatus(req, req.params.id, req.body.status));
  });
  return r;
}
