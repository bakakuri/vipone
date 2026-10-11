#!/usr/bin/env node
// Runs the test groups with Node's built-in test runner.
//   npm test                 unit + integration + security + end-to-end
//   npm run test:unit        no database needed
//   npm run test:integration needs PostgreSQL (TEST_DATABASE_ADMIN_URL)
//   npm run test:e2e         needs PostgreSQL and Playwright's Chromium
// Each file gets its own database copy, so files run one at a time here for
// readable output; node --test can also be pointed at a single file.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GROUPS = { unit: 'tests/unit', integration: 'tests/integration', security: 'tests/security', 'end-to-end': 'tests/e2e' };
const requested = process.argv.slice(2);
const groups = requested.length ? requested : Object.keys(GROUPS);

let failed = 0;
for (const group of groups) {
  const dir = GROUPS[group];
  if (!dir) {
    console.error(`unknown test group: ${group}`);
    process.exit(2);
  }
  const files = readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, f));
  console.log(`\n▶ ${group} (${files.length} files)`);
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...files], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}
process.exit(failed ? 1 : 0);
