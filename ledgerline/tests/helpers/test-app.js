// Boots the real Express app against a fresh test database with the local
// auth provider and the log email provider, listening on a random port.

import { loadConfig, setConfig } from '../../server/config/env.js';
import { createSql, setSql, getSql } from '../../server/db/client.js';
import { setAuthProvider } from '../../server/integrations/auth/index.js';
import { setEmailProvider, getEmailProvider } from '../../server/integrations/email/index.js';
import { setScreeningProvider } from '../../server/integrations/screening/index.js';
import { setKycProvider } from '../../server/integrations/kyc/index.js';
import { resetRateLimits } from '../../server/middleware/rate-limit.js';
import { createApp } from '../../server/app.js';
import { stopListening } from '../../server/modules/live/live-bus.js';
import { createTestDatabase } from './test-db.js';
import { HttpClient } from './http-client.js';

export const TEST_SECRET = 'test-local-jwt-secret-0123456789abcdef';

export async function startTestApp(env = {}, { withSite = false } = {}) {
  const db = await createTestDatabase();
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_MODE: 'demo',
    APP_URL: 'http://127.0.0.1',
    DATABASE_URL: db.url,
    AUTH_PROVIDER: 'local',
    LOCAL_JWT_SECRET: TEST_SECRET,
    COOKIE_SECURE: 'false',
    EMAIL_PROVIDER: 'log',
    RATE_LIMIT_STORE: 'memory',
    BLOCKCHAIN_WEBHOOK_SECRET: 'test-webhook-secret',
    CRON_SECRET: 'test-cron-secret-0123456789abcdef0123',
    DEMO_TOOLS_ENABLED: 'true',
    LOG_LEVEL: 'error',
    ...env,
  });
  setConfig(config);
  setSql(createSql(db.url, { max: 10 }));
  setAuthProvider(undefined);
  setEmailProvider(undefined);
  setScreeningProvider(undefined);
  setKycProvider(undefined);
  resetRateLimits();

  // withSite: also serve the static pages, like the local development server.
  const app = withSite ? (await import('../../server/server.js')).createDevServer() : createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  // Origin checks compare against APP_URL; tests send requests as that origin.
  const origin = baseUrl;
  setConfig({ ...config, allowedOrigins: [origin], appUrl: origin });

  return {
    baseUrl,
    config: { ...config, allowedOrigins: [origin], appUrl: origin },
    sql: getSql(),
    emails: () => getEmailProvider().outbox,
    client: () => new HttpClient(baseUrl, origin),
    async close() {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.(); // long-lived live-update streams
      await closed;
      await stopListening();
      await getSql().end({ timeout: 2 });
      await db.drop();
    },
  };
}
