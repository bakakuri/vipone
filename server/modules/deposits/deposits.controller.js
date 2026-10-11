import { sendCreated, sendData } from '../../core/respond.js';
import { decodeCursor } from '../../utils/schemas.js';
import * as service from './deposits.service.js';

export async function list(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listDeposits(req.auth.userId, { ...q, cursor: decodeCursor(q.cursor) }));
}

export async function address(req, res) {
  sendData(res, await service.getDepositAddress(req.auth, req.validQuery.network));
}

export async function createRequest(req, res) {
  sendCreated(res, await service.createDepositRequest(req.auth, req.body));
}

export async function getOne(req, res) {
  sendData(res, await service.getDeposit(req.auth.userId, req.params.id));
}
