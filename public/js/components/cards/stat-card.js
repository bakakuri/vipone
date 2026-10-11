// A single figure from the server. When the server sends a new value, the
// change is shown with a short transition between the two real values.
import { h, replace } from '../../core/dom.js';
import { countUp } from '../../animations/count-up.js';
import { pulseClass } from '../../animations/motion.js';
import { infoTip } from '../misc/tooltip.js';

export function statCard({ label, hint, render = String, meta, large = false, tour } = {}) {
  const value = h('div', { class: `stat__value num${large ? ' stat__value--lg' : ''}` }, '—');
  const metaEl = h('div', { class: 'stat__meta' }, meta || '');
  const el = h('div', { class: 'stat-card stat', dataset: tour ? { tour } : undefined },
    h('div', { class: 'stat__label' }, label, hint ? infoTip(hint, label) : null), value, metaEl);
  let current = null;
  return {
    el,
    set(next, { metaText } = {}) {
      if (current !== null && current !== next) {
        countUp(value, current, next, render);
        pulseClass(el, 'is-updated');
      } else {
        value.textContent = render(next);
      }
      current = next;
      if (metaText !== undefined) replace(metaEl, metaText);
    },
  };
}
