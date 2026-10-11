// PostgreSQL access through postgres.js.
//
// On Vercel use the Supabase *transaction* pooler (port 6543) for DATABASE_URL
// and keep DB_PREPARE=false: prepared statements are not supported there.
// Numeric values arrive as strings, which keeps money exact.

import postgres from 'postgres';
import { getConfig } from '../config/env.js';
import { mapDbError } from '../core/db-error-map.js';

let sqlInstance;

export function createSql(url, { max = 5, prepare = false } = {}) {
  return postgres(url, {
    max,
    prepare,
    idle_timeout: 20,
    max_lifetime: 60 * 15,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: 'ledgerline', statement_timeout: 15000, TimeZone: 'UTC' },
    transform: { undefined: null },
    // Calendar dates (DATE columns) stay "YYYY-MM-DD" strings, so they never
    // shift by a day when the server's time zone is not UTC.
    types: { date: { to: 1082, from: [1082], serialize: (v) => v, parse: (v) => v } },
  });
}

export function getSql() {
  if (!sqlInstance) {
    const { db } = getConfig();
    sqlInstance = createSql(db.url, { max: db.poolMax, prepare: db.prepare });
  }
  return sqlInstance;
}

export function setSql(sql) {
  sqlInstance = sql;
}

export async function closeDb() {
  if (sqlInstance) {
    const s = sqlInstance;
    sqlInstance = undefined;
    await s.end({ timeout: 5 });
  }
}

// Runs fn inside a single database transaction; Postgres errors are mapped to
// AppErrors so callers never see raw SQL failures.
export async function withTransaction(fn, sql = getSql()) {
  try {
    return await sql.begin((tx) => fn(tx));
  } catch (err) {
    throw mapDbError(err);
  }
}

// Same mapping for single statements outside an explicit transaction.
export async function run(fn, sql = getSql()) {
  try {
    return await fn(sql);
  } catch (err) {
    throw mapDbError(err);
  }
}
