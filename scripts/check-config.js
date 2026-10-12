#!/usr/bin/env node
// Runs first in the Vercel build: validates the environment variables with the
// same rules as the server. A configuration that the server would refuse
// stops the deployment here, so the previous version keeps running instead
// of a site that answers every request with an error.
import { loadConfig } from '../server/config/env.js';

try {
  const config = loadConfig();
  console.log(`Configuration OK: ${config.mode} mode, auth ${config.auth.provider}, ${config.appUrl}`);
  for (const w of config.warnings || []) console.warn(`warning: ${w}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
