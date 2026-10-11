import { sendData } from '../../core/respond.js';
import { decodeCursor } from '../../utils/schemas.js';
import * as service from './notifications.service.js';

export async function list(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listNotifications(req.auth.userId, { ...q, cursor: decodeCursor(q.cursor) }));
}

export async function unreadCount(req, res) {
  sendData(res, await service.unreadCount(req.auth.userId));
}

export async function markRead(req, res) {
  sendData(res, await service.markRead(req.auth.userId, req.params.id));
}

export async function markAllRead(req, res) {
  sendData(res, await service.markAllRead(req.auth.userId));
}
