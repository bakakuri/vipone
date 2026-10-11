import { sendCreated, sendData } from '../../../core/respond.js';
import * as service from './admin-treasury.service.js';

export async function overview(req, res) {
  sendData(res, await service.overview());
}
export async function reconciliations(req, res) {
  sendData(res, await service.reconciliations(req.validQuery.asset));
}
export async function reconcile(req, res) {
  sendCreated(res, await service.reconcile(req, req.body));
}
export async function transfer(req, res) {
  sendCreated(res, await service.transfer(req, req.body, req.idempotencyKey));
}
export async function capital(req, res) {
  sendCreated(res, await service.capital(req, req.body, req.idempotencyKey));
}
export async function integrity(req, res) {
  sendData(res, await service.integrity());
}
