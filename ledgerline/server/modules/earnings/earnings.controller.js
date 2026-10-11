import { sendData } from '../../core/respond.js';
import { decodeCursor } from '../../utils/schemas.js';
import * as service from './earnings.service.js';

export async function list(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listEarnings(req.auth.userId, { ...q, cursor: decodeCursor(q.cursor) }));
}

export async function summary(req, res) {
  sendData(res, await service.earningsSummary(req.auth.userId));
}
