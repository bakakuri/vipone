// Server-Sent Events transport (local development / self-hosting).
// EventSource reconnects automatically; after a session expiry the stream is
// re-opened once the API client has refreshed the session.
export function createSseTransport({ onEvent, onState, refreshSession }) {
  let source = null;
  let stopped = false;
  let retryTimer = null;

  function open() {
    if (stopped) return;
    onState('connecting');
    source = new EventSource('/api/v1/live/stream', { withCredentials: true });
    source.addEventListener('hello', (e) => {
      onState('connected', JSON.parse(e.data).serverTime);
    });
    source.addEventListener('update', (e) => {
      const msg = JSON.parse(e.data);
      onEvent({ topic: msg.topic, event: msg.event, payload: msg.payload || {} });
    });
    source.onerror = async () => {
      if (stopped) return;
      if (source.readyState === EventSource.CLOSED) {
        onState('reconnecting');
        source.close();
        await refreshSession().catch(() => {});
        clearTimeout(retryTimer);
        retryTimer = setTimeout(open, 3000);
      } else {
        onState('reconnecting');
      }
    };
  }

  return {
    start: open,
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      source?.close();
    },
  };
}
