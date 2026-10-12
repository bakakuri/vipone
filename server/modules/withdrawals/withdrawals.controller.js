import { getConfig } from '../../config/env.js';
import { sendCreated, sendData } from '../../core/respond.js';
import { clientIpHash, userAgent } from '../../middleware/client-ip.js';
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
  sendData(res, await service.createQuote(req.auth, req.body, { ipHash: clientIpHash(req, getConfig()), userAgent: userAgent(req) }));
}

export async function create(req, res) {
  sendCreated(res, await service.createWithdrawal(req.auth, req.body, req.idempotencyKey));
}

export async function cancel(req, res) {
  sendData(res, await service.cancelWithdrawal(req.auth, req.params.id));
}
