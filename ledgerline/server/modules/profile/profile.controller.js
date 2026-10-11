import { sendData } from '../../core/respond.js';
import * as service from './profile.service.js';

export async function get(req, res) {
  sendData(res, await service.getProfile(req.auth.userId));
}

export async function updatePreferences(req, res) {
  sendData(res, await service.updatePreferences(req.auth.userId, req.body));
}

export async function updateOnboarding(req, res) {
  sendData(res, await service.updateOnboarding(req.auth.userId, req.body));
}

export async function securityEvents(req, res) {
  sendData(res, await service.securityEvents(req.auth.userId));
}

export async function startKyc(req, res) {
  sendData(res, await service.startKyc(req.auth));
}
