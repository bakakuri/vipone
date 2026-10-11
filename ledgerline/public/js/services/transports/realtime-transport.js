// Supabase Realtime transport (production). Implements the small part of the
// Phoenix channel protocol needed for PRIVATE broadcast channels:
// join with the user's access token, heartbeat, token refresh, rejoin.
// RLS on realtime.messages allows a user to join only "user:<own id>"
// (and staff "admin:ops"). The token is fetched from /api/v1/live/token and
// kept in memory only.
const HEARTBEAT_MS = 25000;
const BACKOFF = [1000, 2000, 5000, 10000, 20000, 30000];

export function createRealtimeTransport({ url, publishableKey, topics, getToken, onEvent, onState }) {
  let ws = null;
  let ref = 0;
  let attempts = 0;
  let stopped = false;
  let heartbeat = null;
  let tokenTimer = null;
  let reconnectTimer = null;
  let token = null;
  const joinRefs = new Map();

  const nextRef = () => String(++ref);
  const send = (msg) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

  async function loadToken() {
    const data = await getToken();
    token = data.accessToken;
    clearTimeout(tokenTimer);
    const refreshInMs = data.expiresAt ? Math.max(30000, data.expiresAt * 1000 - Date.now() - 60000) : 10 * 60000;
    tokenTimer = setTimeout(async () => {
      try {
        await loadToken();
        for (const topic of topics) send({ topic: `realtime:${topic}`, event: 'access_token', payload: { access_token: token }, ref: nextRef(), join_ref: joinRefs.get(topic) });
      } catch {
        ws?.close();
      }
    }, refreshInMs);
  }

  function join(topic) {
    const r = nextRef();
    joinRefs.set(topic, r);
    send({
      topic: `realtime:${topic}`,
      event: 'phx_join',
      payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, postgres_changes: [], private: true }, access_token: token },
      ref: r,
      join_ref: r,
    });
  }

  function scheduleReconnect() {
    if (stopped) return;
    onState('reconnecting');
    const delay = BACKOFF[Math.min(attempts, BACKOFF.length - 1)];
    attempts += 1;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
  }

  async function connect() {
    if (stopped) return;
    onState(attempts ? 'reconnecting' : 'connecting');
    try {
      await loadToken();
    } catch {
      scheduleReconnect();
      return;
    }
    const wsUrl = `${url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(publishableKey)}&vsn=1.0.0`;
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      topics.forEach(join);
      clearInterval(heartbeat);
      heartbeat = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() }), HEARTBEAT_MS);
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.event === 'phx_reply' && [...joinRefs.values()].includes(msg.ref)) {
        if (msg.payload?.status === 'ok') {
          attempts = 0;
          onState('connected', new Date().toISOString());
        } else {
          onState('reconnecting');
        }
        return;
      }
      if (msg.event === 'broadcast' && msg.payload) {
        onEvent({ topic: msg.topic.replace(/^realtime:/, ''), event: msg.payload.event, payload: msg.payload.payload || {} });
      }
      if (msg.event === 'phx_error' || msg.event === 'phx_close') ws.close();
    };
    ws.onclose = () => {
      clearInterval(heartbeat);
      scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  return {
    start: connect,
    stop() {
      stopped = true;
      clearInterval(heartbeat);
      clearTimeout(tokenTimer);
      clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
