import { sendCreated, sendData } from '../../core/respond.js';
import * as service from './support.service.js';

export async function list(req, res) {
  sendData(res, await service.listTickets(req.auth.userId));
}

export async function create(req, res) {
  sendCreated(res, await service.createTicket(req.auth.userId, req.body));
}

export async function getOne(req, res) {
  sendData(res, await service.getTicket(req.auth.userId, req.params.id));
}

export async function addMessage(req, res) {
  sendCreated(res, await service.addMessage(req.auth.userId, req.params.id, req.body.body));
}
