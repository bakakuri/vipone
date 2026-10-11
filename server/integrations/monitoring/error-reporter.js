// Error monitoring. Every unexpected error is logged as structured JSON (Vercel
// log drains can forward these to any monitoring service). If ERROR_WEBHOOK_URL
// is set, a compact report is also POSTed there (Slack/Teams webhook, Sentry
// relay, etc.), rate limited to avoid floods.

import { getConfig } from '../../config/env.js';
import { logger, requestContext, serializeError } from '../../core/logger.js';

let windowStart = 0;
let sentInWindow = 0;

export function reportError(err, context = {}) {
  const ctx = requestContext.getStore();
  logger.error('unhandled_error', { error: serializeError(err), ...context });
  let url;
  try {
    url = getConfig().errorWebhookUrl;
  } catch {
    return;
  }
  if (!url) return;
  const now = Date.now();
  if (now - windowStart > 60000) {
    windowStart = now;
    sentInWindow = 0;
  }
  if (sentInWindow >= 10) return;
  sentInWindow += 1;
  const text = `[${getConfig().appName}] ${err?.name || 'Error'}: ${err?.message || err} (request ${ctx?.requestId || '-'})`;
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, error: serializeError(err), context, requestId: ctx?.requestId }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
