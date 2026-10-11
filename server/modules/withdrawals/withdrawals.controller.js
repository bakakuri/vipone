import { sendCreated, sendData } from '../../core/respond.js';
import { decodeCursor } from '../../utils/schemas.js';
import * as service from './withdrawals.service.js';

export async function list(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listWithdrawals(req.auth.userId, { ...q, cursor: decodeCursor(q.cursor) }));
}

export async function getOne(req, res) {
  sendData(res, await service.getWithdrawal(req.auth.userId, req.params.id));
}

export async function quote(req, res) {
  sendData(res, await service.createQuote(req.auth, req.body));
}

export async function create(req, res) {
  sendCreated(res, await service.createWithdrawal(req.auth, req.body, req.idempotencyKey));
}

export async function cancel(req, res) {
  sendData(res, await service.cancelWithdrawal(req.auth, req.params.id));
}
