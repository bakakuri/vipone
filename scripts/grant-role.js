#!/usr/bin/env node
// Bootstraps staff access from the command line (needs a database
// connection with owner rights, i.e. server-side only). After the first
// super administrator exists, every further role change goes through the
// admin panel and a second approver.
//   npm run admin:grant -- someone@example.org super_admin
//   npm run admin:grant -- someone@example.org finance --revoke

import { createSql } from '../server/db/client.js';

const ROLES = ['support', 'finance', 'compliance', 'super_admin'];
const [email, role, flag] = process.argv.slice(2);
if (!email || !ROLES.includes(role)) {
  console.error(`usage: npm run admin:grant -- <email> <${ROLES.join('|')}> [--revoke]`);
  process.exit(1);
}
// Only a database connection is needed (not the full app configuration).
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL (or MIGRATION_DATABASE_URL) to the database connection string.');
  process.exit(1);
}
const sql = createSql(url, { max: 1 });
try {
  const [user] = await sql`select id, mfa_enabled from app.profiles where lower(email) = lower(${email})`;
  if (!user) throw new Error(`No profile for ${email}. The person must register and confirm their email first.`);
  if (flag === '--revoke') {
    await sql`delete from app.user_roles where user_id = ${user.id} and role = ${role}`;
    await sql`insert into app.audit_logs (action, entity_type, entity_id, after_state, reason)
              values ('role.revoked_cli', 'profile', ${user.id}, ${sql.json({ role })}, 'Command-line bootstrap')`;
    console.log(`Revoked ${role} from ${email}.`);
  } else {
    await sql`insert into app.user_roles (user_id, role) values (${user.id}, ${role}) on conflict do nothing`;
    await sql`insert into app.audit_logs (action, entity_type, entity_id, after_state, reason)
              values ('role.granted_cli', 'profile', ${user.id}, ${sql.json({ role })}, 'Command-line bootstrap')`;
    console.log(`Granted ${role} to ${email}.`);
    if (!user.mfa_enabled) console.log('Note: staff must turn on two-factor authentication; production requires it for the admin area.');
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
