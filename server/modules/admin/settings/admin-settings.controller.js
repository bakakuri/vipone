import { sendCreated, sendData } from '../../../core/respond.js';
import * as service from './admin-settings.service.js';

export async function list(req, res) {
  sendData(res, await service.listSettings());
}

export async function history(req, res) {
  sendData(res, await service.settingHistory(req.params.key));
}

export async function change(req, res) {
  const result = await service.changeSetting(req, req.params.key, req.body.value, req.body.reason);
  sendData(res, result, { status: result.applied ? 200 : 202 });
}

export async function feeRules(req, res) {
  sendData(res, await service.listFeeRules());
}

export async function requestFeeRule(req, res) {
  sendCreated(res, await service.requestFeeRule(req, req.body));
}

export async function requestAdjustment(req, res) {
  sendCreated(res, await service.requestAdjustment(req, req.body));
}
