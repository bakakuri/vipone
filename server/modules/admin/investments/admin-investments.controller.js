import { sendCreated, sendData } from '../../../core/respond.js';
import * as service from './admin-investments.service.js';

export async function products(req, res) {
  sendData(res, await service.listProducts());
}
export async function createProduct(req, res) {
  sendCreated(res, await service.createProduct(req, req.body));
}
export async function updateProduct(req, res) {
  sendData(res, await service.updateProduct(req, req.params.id, req.body));
}
export async function setStatus(req, res) {
  sendData(res, await service.setProductStatus(req, req.params.id, req.body.status));
}
export async function results(req, res) {
  sendData(res, await service.listResults(req.validQuery));
}
export async function createResult(req, res) {
  sendCreated(res, await service.createResult(req, req.body));
}
export async function previewResult(req, res) {
  sendData(res, await service.previewResult(req.params.id));
}
export async function approveResult(req, res) {
  sendData(res, await service.approveResult(req, req.params.id));
}
export async function rejectResult(req, res) {
  sendData(res, await service.rejectResult(req, req.params.id, req.body.reason));
}
export async function postResult(req, res) {
  sendData(res, await service.postResult(req, req.params.id));
}
