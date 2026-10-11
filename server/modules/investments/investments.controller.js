import { sendCreated, sendData } from '../../core/respond.js';
import * as service from './investments.service.js';

export async function products(req, res) {
  sendData(res, await service.listProducts());
}

export async function positions(req, res) {
  sendData(res, await service.listPositions(req.auth.userId, req.validQuery));
}

export async function position(req, res) {
  sendData(res, await service.getPosition(req.auth.userId, req.params.id));
}

export async function open(req, res) {
  sendCreated(res, await service.openPosition(req.auth, req.body, req.idempotencyKey));
}

export async function closeEarly(req, res) {
  sendData(res, await service.closeEarly(req.auth, req.params.id));
}
