import { sendData } from '../../core/respond.js';
import * as service from './dashboard.service.js';

export async function summary(req, res) {
  sendData(res, await service.getDashboard(req.auth.userId));
}

export async function history(req, res) {
  sendData(res, await service.getHistory(req.auth.userId, req.validQuery));
}
