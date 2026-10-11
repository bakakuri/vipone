import { sendData } from '../../../core/respond.js';
import { decodeCursor } from '../../../utils/schemas.js';
import * as service from './admin-referrals.service.js';

export async function rewards(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listRewards({ ...q, cursor: decodeCursor(q.cursor) }));
}
export async function relationships(req, res) {
  sendData(res, await service.listRelationships(req.validQuery));
}
export async function suspicious(req, res) {
  sendData(res, await service.suspicious());
}
export async function review(req, res) {
  sendData(res, await service.reviewReward(req, req.params.id, req.body));
}
