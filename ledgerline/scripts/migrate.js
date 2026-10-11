#!/usr/bin/env node
// Applies supabase/migrations/*.sql in order and records each one with its
// checksum. Applied migrations are immutable: editing one fails the run.
//
//   npm run db:migrate                 # Supabase / production database
//   npm run db:migrate:local           # plain PostgreSQL (adds the local shim)
//
// With the Supabase CLI you can instead run `supabase db push`; both use the
// same files. Use a direct or session-pooler connection string for migrations.

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const SHIM_FILE = path.join(ROOT, 'database', 'local', 'supabase-shim.sql');

const checksum = (text) => createHash('sha256').update(text).digest('hex');

export async function migrate({ url, withShim = false, log = (msg) => console.log(msg) }) {
  if (!url) throw new Error('A database URL is required (MIGRATION_DATABASE_URL or DATABASE_URL).');
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  try {
    if (withShim) {
      await sql.unsafe(await readFile(SHIM_FILE, 'utf8'));
      log('applied local Supabase shim');
    }

    await sql.unsafe(`
      create table if not exists public.ledgerline_migrations (
        version text primary key,
        name text not null,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`);

    const applied = new Map(
      (await sql`select version, checksum from public.ledgerline_migrations`).map((r) => [r.version, r.checksum]),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort();

    let count = 0;
    for (const file of files) {
      const version = file.slice(0, 14);
      const body = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const sum = checksum(body);
      if (applied.has(version)) {
        if (applied.get(version) !== sum) {
          throw new Error(`Migration ${file} was modified after it was applied. Create a new migration instead.`);
        }
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into public.ledgerline_migrations (version, name, checksum) values (${version}, ${file}, ${sum})`;
      });
      count += 1;
      log(`applied ${file}`);
    }
    log(count === 0 ? 'database is up to date' : `${count} migration(s) applied`);
    return count;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  migrate({ url, withShim: process.argv.includes('--with-local-shim') }).catch((err) => {
    console.error(`Migration failed: ${err.message}`);
    if (err.detail) console.error(err.detail);
    process.exitCode = 1;
  });
}
