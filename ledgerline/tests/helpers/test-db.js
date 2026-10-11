// Test databases. A template database is built once from the local Supabase
// shim + all migrations; every test file then gets its own fresh copy
// (CREATE DATABASE ... TEMPLATE ...), so tests are isolated and fast.
//
// TEST_DATABASE_ADMIN_URL: a superuser connection to a PostgreSQL 15+ server,
// e.g. the one from `supabase start` or a Docker postgres:16 container.

import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { migrate } from '../../scripts/migrate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = 'ledgerline_test_template';

export function adminUrl() {
  return process.env.TEST_DATABASE_ADMIN_URL || 'postgres://postgres@127.0.0.1:54329/postgres';
}

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function migrationsFingerprint() {
  const hash = createHash('sha256');
  const dir = path.join(ROOT, 'supabase/migrations');
  for (const f of (await readdir(dir)).sort()) hash.update(f).update(await readFile(path.join(dir, f)));
  hash.update(await readFile(path.join(ROOT, 'database/local/supabase-shim.sql')));
  return hash.digest('hex').slice(0, 16);
}

export async function ensureTemplate() {
  const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
  try {
    const fingerprint = await migrationsFingerprint();
    const [existing] = await admin`
      select d.datname, shobj_description(d.oid, 'pg_database') as note from pg_database d where d.datname = ${TEMPLATE}`;
    if (existing && existing.note === fingerprint) return;
    if (existing) {
      await admin.unsafe(`update pg_database set datistemplate = false where datname = '${TEMPLATE}'`);
      await admin.unsafe(`drop database ${TEMPLATE} with (force)`);
    }
    await admin.unsafe(`create database ${TEMPLATE}`);
    await migrate({ url: withDatabase(adminUrl(), TEMPLATE), withShim: true, log: () => {} });
    await admin.unsafe(`comment on database ${TEMPLATE} is '${fingerprint}'`);
    await admin.unsafe(`update pg_database set datistemplate = true where datname = '${TEMPLATE}'`);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

export async function createTestDatabase() {
  await ensureTemplate();
  const name = `ll_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database ${name} template ${TEMPLATE}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  return {
    url: withDatabase(adminUrl(), name),
    async drop() {
      const a = postgres(adminUrl(), { max: 1, onnotice: () => {} });
      try {
        await a.unsafe(`drop database if exists ${name} with (force)`);
      } finally {
        await a.end({ timeout: 5 });
      }
    },
  };
}
