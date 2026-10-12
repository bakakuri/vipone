import { sendCreated, sendData } from '../../../core/respond.js';
import { decodeCursor } from '../../../utils/schemas.js';
import * as methods from './admin-deposit-methods.service.js';
import * as service from './admin-deposits.service.js';

export async function list(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listDeposits({ ...q, cursor: decodeCursor(q.cursor) }));
}

export async function getOne(req, res) {
  sendData(res, await service.getDeposit(req.params.id));
}

export async function review(req, res) {
  sendData(res, await service.reviewDeposit(req, req.params.id, req.body));
}

export async function returnFunds(req, res) {
  sendData(res, await service.returnDeposit(req, req.params.id, req.body));
}

export async function pool(req, res) {
  sendData(res, await service.addressPool());
}

export async function importPool(req, res) {
  sendData(res, await service.importAddresses(req, req.body));
}

export async function listMethods(req, res) {
  sendData(res, await methods.listMethods());
}

export async function createMethod(req, res) {
  sendCreated(res, await methods.createMethod(req, req.body));
}

export async function updateMethod(req, res) {
  sendData(res, await methods.updateMethod(req, req.params.id, req.body));
}

export async function removeMethod(req, res) {
  sendData(res, await methods.removeMethod(req, req.params.id));
}

export async function approveManual(req, res) {
  sendData(res, await methods.approveManual(req, req.params.id, req.body));
}
