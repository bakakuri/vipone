// Re-fetch real data when the server reports a change. Several events in a
// burst (e.g. balance + deposit) trigger one refresh. Hidden tabs refresh
// when they become visible again.
import { onLive } from './live-connection.js';
import { debounce } from '../utils/debounce.js';

export function liveRefresh(events, refresh, { wait = 400 } = {}) {
  let stale = false;
  const run = debounce(() => {
    if (document.hidden) {
      stale = true;
      return;
    }
    refresh();
  }, wait);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && stale) {
      stale = false;
      refresh();
    }
  });
  return onLive(events, run);
}
