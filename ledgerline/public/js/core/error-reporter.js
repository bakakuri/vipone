// Sends uncaught browser errors to /api/v1/client-errors (structured logs on
// the server). Messages only — no user input, no personal data.
let sent = 0;

function report(payload) {
  if (sent >= 10) return;
  sent += 1;
  try {
    const body = JSON.stringify({ ...payload, page: location.pathname.slice(0, 200) });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/v1/client-errors', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/v1/client-errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* never throw from the reporter */
  }
}

export function installErrorReporter() {
  window.addEventListener('error', (e) => {
    report({ message: String(e.message || 'error').slice(0, 500), source: String(e.filename || '').slice(0, 300), line: e.lineno || 0, column: e.colno || 0, stack: String(e.error?.stack || '').slice(0, 4000) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    if (reason?.name === 'ApiError') return; // already handled and shown to the user
    report({ message: String(reason?.message || reason || 'unhandled rejection').slice(0, 500), stack: String(reason?.stack || '').slice(0, 4000) });
  });
}
