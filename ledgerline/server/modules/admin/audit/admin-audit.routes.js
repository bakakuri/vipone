import { Router } from 'express';
import { z } from 'zod';
import { sendData } from '../../../core/respond.js';
import { getSql } from '../../../db/client.js';
import { requirePermission } from '../../../middleware/authenticate.js';
import { validate } from '../../../middleware/validate.js';
import { camelize } from '../../../utils/camelize.js';
import { listAudit } from '../../audit/audit.service.js';

const query = z.object({
  entityType: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  entityId: z.string().max(100).optional(),
  actorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
});

export function adminAuditRoutes() {
  const r = Router();
  r.get('/', requirePermission('audit.read'), validate({ query }), async (req, res) => {
    const q = req.validQuery;
    const rows = await listAudit(getSql(), { ...q, cursor: q.before ? { id: q.before } : null });
    const items = rows.slice(0, q.limit).map(camelize);
    sendData(res, { items, nextBefore: rows.length > q.limit ? items[items.length - 1].id : null });
  });
  return r;
}
