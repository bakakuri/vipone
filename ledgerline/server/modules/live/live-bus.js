// In-process fan-out of database events (pg_notify 'app_events') to SSE
// clients. One LISTEN connection per server instance, opened on first use.
// Production on Vercel uses Supabase Realtime instead; this is the fallback
// for local development and self-hosting.

import { EventEmitter } from 'node:events';
import { getConfig } from '../../config/env.js';
import { logger } from '../../core/logger.js';
import { createSql } from '../../db/client.js';

const bus = new EventEmitter();
bus.setMaxListeners(10000);
let listening = null;
let listenSql = null;

export async function ensureListening() {
  if (listening) return listening;
  listening = (async () => {
    listenSql = createSql(getConfig().db.directUrl, { max: 1 });
    await listenSql.listen('app_events', (payload) => {
      try {
        const event = JSON.parse(payload);
        bus.emit(event.topic, event);
      } catch (err) {
        logger.warn('live_event_parse_failed', { error: err.message });
      }
    });
  })().catch((err) => {
    listening = null;
    throw err;
  });
  return listening;
}

export function subscribe(topic, handler) {
  bus.on(topic, handler);
  return () => bus.off(topic, handler);
}

export async function stopListening() {
  if (listenSql) await listenSql.end({ timeout: 2 });
  listenSql = null;
  listening = null;
}
