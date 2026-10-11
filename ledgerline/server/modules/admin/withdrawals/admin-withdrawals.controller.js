import { sendData } from '../../../core/respond.js';
import { decodeCursor } from '../../../utils/schemas.js';
import * as service from './admin-withdrawals.service.js';

export async function list(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listWithdrawals({ ...q, cursor: decodeCursor(q.cursor) }));
}
export async function getOne(req, res) {
  sendData(res, await service.getWithdrawal(req.params.id));
}
export async function review(req, res) {
  sendData(res, await service.review(req, req.params.id, req.body));
}
export async function approve(req, res) {
  sendData(res, await service.approve(req, req.params.id));
}
export async function reject(req, res) {
  sendData(res, await service.reject(req, req.params.id, req.body));
}
export async function process(req, res) {
  sendData(res, await service.startProcessing(req, req.params.id));
}
export async function broadcast(req, res) {
  sendData(res, await service.recordBroadcast(req, req.params.id, req.body));
}
export async function complete(req, res) {
  sendData(res, await service.complete(req, req.params.id, req.body));
}
export async function fail(req, res) {
  sendData(res, await service.fail(req, req.params.id, req.body));
}
