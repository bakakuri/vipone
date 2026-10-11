import { sendData } from '../../../core/respond.js';
import { decodeCursor } from '../../../utils/schemas.js';
import * as service from './admin-users.service.js';

export async function list(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listUsers({ ...q, cursor: decodeCursor(q.cursor) }));
}

export async function getOne(req, res) {
  sendData(res, await service.getUser(req.params.id));
}

export async function setStatus(req, res) {
  const result = await service.setStatus(req, req.params.id, req.body);
  sendData(res, result, { status: result.applied ? 200 : 202 });
}

export async function decideKyc(req, res) {
  sendData(res, await service.decideKyc(req, req.params.id, req.body));
}

export async function requestRole(req, res) {
  sendData(res, await service.requestRoleChange(req, req.params.id, req.body), { status: 202 });
}

export async function riskFlags(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listRiskFlags({ ...q, cursor: decodeCursor(q.cursor) }));
}

export async function resolveFlag(req, res) {
  sendData(res, await service.resolveRiskFlag(req, req.params.id, req.body));
}
