import { sendData } from '../../../core/respond.js';
import { decodeCursor } from '../../../utils/schemas.js';
import * as service from './admin-approvals.service.js';

export async function list(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listApprovals({ ...q, cursor: decodeCursor(q.cursor) }));
}

export async function approve(req, res) {
  sendData(res, await service.approve(req, req.params.id, req.body.note));
}

export async function reject(req, res) {
  sendData(res, await service.reject(req, req.params.id, req.body.note));
}
