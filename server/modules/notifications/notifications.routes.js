import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import * as c from './notifications.controller.js';
import * as v from './notifications.validators.js';

export function notificationsRoutes() {
  const r = Router();
  r.use(authenticate());
  r.get('/', validate({ query: v.listQuery }), c.list);
  r.get('/unread-count', c.unreadCount);
  r.post('/read-all', c.markAllRead);
  r.post('/:id/read', validate({ params: v.idParams }), c.markRead);
  return r;
}
