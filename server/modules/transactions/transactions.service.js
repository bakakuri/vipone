import { AppError } from '../../core/errors.js';
import { getSql } from '../../db/client.js';
import { camelize, trimAmount } from '../../utils/camelize.js';
import { pageOf } from '../../utils/schemas.js';
import * as repo from './transactions.repository.js';

function toApi(row) {
  const t = camelize(row);
  t.amount = trimAmount(row.amount);
  t.asset = row.asset_code;
  delete t.assetCode;
  return t;
}

export async function listTransactions(userId, filters) {
  const rows = await repo.listActivity(getSql(), userId, filters);
  const page = pageOf(rows, filters.limit, 'posted_at');
  return { items: page.items.map(toApi), nextCursor: page.nextCursor };
}

export async function getTransaction(userId, id) {
  const result = await repo.getTransactionForUser(getSql(), userId, id);
  if (!result) throw new AppError('not_found');
  return {
    ...camelize(result.tx),
    entries: result.entries.map((e) => ({ ...camelize(e), amount: trimAmount(e.amount) })),
  };
}

// CSV export (spreadsheet-safe: text cells that could be read as formulas are
// prefixed with an apostrophe; amounts stay plain numbers).
export async function exportCsv(userId, filters) {
  const rows = await repo.listActivity(getSql(), userId, { ...filters, limit: 5000 });
  const safeText = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  const header = ['date_utc', 'type', 'asset', 'amount', 'status', 'reference', 'tx_hash', 'ledger_transaction_id', 'included_in_other_row'];
  const lines = rows.slice(0, 5000).map((r) =>
    [
      safeText(new Date(r.posted_at).toISOString()),
      safeText(r.type),
      safeText(r.asset_code),
      trimAmount(r.amount),
      safeText(r.status),
      safeText(r.reference),
      safeText(r.tx_hash),
      safeText(r.ledger_transaction_id),
      r.informational ? 'yes' : 'no',
    ].join(','),
  );
  return `${header.join(',')}\n${lines.join('\n')}\n`;
}
