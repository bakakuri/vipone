// Live Mode: receives "something changed" signals and lets pages re-fetch the
// real data. Shows Live / Reconnecting / Offline and the last update time,
// taken from the server clock. Nothing here creates or animates values on a
// timer: if no data changed, nothing on screen changes.
import { liveApi, authApi } from '../api/endpoints.js';
import { emit, listen } from '../core/events.js';
import { createRealtimeTransport } from './transports/realtime-transport.js';
import { createSseTransport } from './transports/sse-transport.js';

let transport = null;
let state = 'idle';
let lastUpdated = null;
const handlers = new Map();

function setState(next, serverTime) {
  state = navigator.onLine ? next : 'offline';
  if (serverTime) lastUpdated = serverTime;
  emit('live:state', { state, lastUpdated });
}

export function liveState() {
  return { state, lastUpdated };
}

function dispatch(evt) {
  if (evt.payload?.at) lastUpdated = evt.payload.at;
  emit('live:state', { state, lastUpdated });
  for (const [event, fns] of handlers) {
    if (event === '*' || event === evt.event) fns.forEach((fn) => fn(evt));
  }
}

export function onLive(events, handler) {
  const list = Array.isArray(events) ? events : [events];
  for (const e of list) {
    if (!handlers.has(e)) handlers.set(e, new Set());
    handlers.get(e).add(handler);
  }
  return () => list.forEach((e) => handlers.get(e)?.delete(handler));
}

export async function startLive() {
  if (transport) return;
  let config;
  try {
    config = await liveApi.config();
  } catch {
    setState('offline');
    return;
  }
  if (!config.enabled) {
    setState('disabled');
    return;
  }
  const common = { onEvent: dispatch, onState: setState };
  transport =
    config.transport === 'supabase' && config.realtime
      ? createRealtimeTransport({ ...common, url: config.realtime.url, publishableKey: config.realtime.publishableKey, topics: config.topics, getToken: () => liveApi.token() })
      : createSseTransport({ ...common, refreshSession: () => authApi.session() });
  transport.start();

  window.addEventListener('offline', () => setState('offline'));
  window.addEventListener('online', () => setState('reconnecting'));
  listen('server:time', (time) => {
    lastUpdated = time;
    emit('live:state', { state, lastUpdated });
  });
}

export function stopLive() {
  transport?.stop();
  transport = null;
}
