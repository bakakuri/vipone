// "Live · updated 10:42:05" — the time is the SERVER time of the last real
// update, so stale data is never presented as fresh.
import { h, replace } from '../../core/dom.js';
import { listen } from '../../core/events.js';
import { formatTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { pulseClass } from '../../animations/motion.js';
import { liveState } from '../../services/live-connection.js';

export function liveIndicator() {
  const dot = h('span', { class: 'live-indicator__dot', 'aria-hidden': 'true' });
  const label = h('span', {});
  const time = h('span', { class: 'live-indicator__time num' });
  const el = h('span', { class: 'live-indicator', role: 'status', 'aria-live': 'polite' }, dot, label, time);

  function render({ state, lastUpdated }) {
    el.dataset.state = state;
    replace(label, t(`common:live.${{ connected: 'live', idle: 'connecting' }[state] || state}`));
    const text = lastUpdated ? t('common:live.updatedAt', { time: formatTime(lastUpdated) }) : '';
    if (time.textContent !== text) {
      time.textContent = text;
      pulseClass(el, 'is-tick', 500);
    }
  }
  render(liveState());
  listen('live:state', render);
  listen('locale:changed', () => render(liveState()));
  return el;
}
