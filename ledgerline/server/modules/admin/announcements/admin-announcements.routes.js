// Announcements are written in all three languages and delivered to every
// active account as an in-app notification.

import { Router } from 'express';
import { z } from 'zod';
import { sendCreated, sendData } from '../../../core/respond.js';
import { getSql, withTransaction } from '../../../db/client.js';
import { requirePermission } from '../../../middleware/authenticate.js';
import { validate } from '../../../middleware/validate.js';
import { camelize } from '../../../utils/camelize.js';
import { localizedText } from '../../../utils/schemas.js';
import { audit } from '../../audit/audit.service.js';

export function adminAnnouncementsRoutes() {
  const r = Router();
  r.use(requirePermission('announcements.manage'));
  r.get('/', async (req, res) => {
    const rows = await getSql()`
      select a.*, p.email as published_by_email from app.announcements a join app.profiles p on p.id = a.published_by
      order by a.published_at desc limit 50`;
    sendData(res, rows.map(camelize));
  });
  r.post('/', validate({ body: z.object({ title: localizedText(140), body: localizedText(2000) }) }), async (req, res) => {
    const result = await withTransaction(async (tx) => {
      const [a] = await tx`
        insert into app.announcements (title, body, published_by) values (${tx.json(req.body.title)}, ${tx.json(req.body.body)}, ${req.auth.userId})
        returning *`;
      const delivered = await tx`
        insert into app.notifications (user_id, type, params, link)
        select id, 'announcement', ${tx.json({ announcementId: a.id, title: req.body.title, body: req.body.body })}, '/notifications'
        from app.profiles where status in ('active', 'restricted')
        returning id`;
      await audit(tx, req, { action: 'announcement.published', entityType: 'announcement', entityId: a.id, after: { recipients: delivered.length } });
      return { ...camelize(a), recipients: delivered.length };
    });
    sendCreated(res, result);
  });
  return r;
}
