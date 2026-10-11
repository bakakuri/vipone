import { sendData } from '../../core/respond.js';
import { decodeCursor } from '../../utils/schemas.js';
import * as service from './transactions.service.js';

export async function list(req, res) {
  const q = req.validQuery;
  sendData(res, await service.listTransactions(req.auth.userId, { ...q, cursor: decodeCursor(q.cursor) }));
}

export async function getOne(req, res) {
  sendData(res, await service.getTransaction(req.auth.userId, req.params.id));
}

export async function exportCsv(req, res) {
  const q = req.validQuery;
  const csv = await service.exportCsv(req.auth.userId, { ...q, cursor: null });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${csv}`);
}
