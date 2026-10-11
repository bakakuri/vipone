import { sendData } from '../../core/respond.js';
import { decodeCursor } from '../../utils/schemas.js';
import * as service from './referrals.service.js';

export async function overview(req, res) {
  sendData(res, await service.getOverview(req.auth.userId));
}

export async function rewards(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listRewards(req.auth.userId, { ...q, cursor: decodeCursor(q.cursor) }));
}
