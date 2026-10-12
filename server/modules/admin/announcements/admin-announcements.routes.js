// Announcements are delivered to every active account as an in-app
// notification. Staff can correct one later (the delivered notifications
// show the new text) or delete it (it disappears from every inbox).

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../../core/errors.js';
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
  const idParams = z.object({ id: z.string().uuid() });
  const textBody = z.object({ title: localizedText(140), body: localizedText(2000) });
  r.patch('/:id', validate({ params: idParams, body: textBody }), async (req, res) => {
    const result = await withTransaction(async (tx) => {
      const [before] = await tx`select * from app.announcements where id = ${req.params.id} for update`;
      if (!before) throw new AppError('not_found');
      const [a] = await tx`
        update app.announcements set title = ${tx.json(req.body.title)}, body = ${tx.json(req.body.body)}
        where id = ${req.params.id} returning *`;
      await tx`
        update app.notifications
        set params = params || ${tx.json({ title: req.body.title, body: req.body.body })}
        where type = 'announcement' and params->>'announcementId' = ${a.id}::text`;
      await audit(tx, req, { action: 'announcement.updated', entityType: 'announcement', entityId: a.id,
        before: { title: before.title, body: before.body }, after: { title: a.title, body: a.body } });
      return camelize(a);
    });
    sendData(res, result);
  });
  r.delete('/:id', validate({ params: idParams }), async (req, res) => {
    const result = await withTransaction(async (tx) => {
      const [before] = await tx`select * from app.announcements where id = ${req.params.id} for update`;
      if (!before) throw new AppError('not_found');
      const removed = await tx`
        delete from app.notifications where type = 'announcement' and params->>'announcementId' = ${before.id}::text returning id`;
      await tx`delete from app.announcements where id = ${before.id}`;
      await audit(tx, req, { action: 'announcement.deleted', entityType: 'announcement', entityId: before.id,
        before: { title: before.title, body: before.body }, after: { notificationsRemoved: removed.length } });
      return { deleted: true, id: before.id };
    });
    sendData(res, result);
  });
  return r;
}
