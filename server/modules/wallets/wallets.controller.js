import { getConfig } from '../../config/env.js';
import { sendCreated, sendData } from '../../core/respond.js';
import { clientIpHash, userAgent } from '../../middleware/client-ip.js';
import * as service from './wallets.service.js';

const ctxOf = (req) => ({ ipHash: clientIpHash(req, getConfig()), userAgent: userAgent(req) });

export async function list(req, res) {
  sendData(res, await service.listWallets(req.auth.userId));
}

export async function history(req, res) {
  sendData(res, await service.walletHistory(req.auth.userId));
}

export async function add(req, res) {
  sendCreated(res, await service.addWallet(req.auth, req.body, ctxOf(req)));
}

export async function confirm(req, res) {
  sendData(res, await service.confirmWallet(req.auth, req.params.id, req.body.code, ctxOf(req)));
}

export async function resend(req, res) {
  sendData(res, await service.resendCode(req.auth, req.params.id));
}

export async function setDefault(req, res) {
  sendData(res, await service.setDefault(req.auth, req.params.id));
}

export async function remove(req, res) {
  sendData(res, await service.removeWallet(req.auth, req.params.id, ctxOf(req)));
}
