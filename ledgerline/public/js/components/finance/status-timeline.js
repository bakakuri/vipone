// Vertical timeline of an operation's lifecycle. Steps up to the current
// status are marked done; a failed/rejected/cancelled outcome ends the line.
import { h } from '../../core/dom.js';
import { formatDateTime } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';

export function statusTimeline(steps) {
  return h('ol', { class: 'timeline' }, steps.map((s) =>
    h('li', { class: `timeline__item ${s.done ? 'is-done' : ''} ${s.failed ? 'is-failed' : ''}`.trim() },
      h('span', { class: 'timeline__dot', 'aria-hidden': 'true' }),
      h('div', {},
        h('div', { class: 'timeline__title' }, s.label, s.done ? h('span', { class: 'visually-hidden' }, ` (${t('common:status.completed')})`) : null),
        s.at ? h('div', { class: 'timeline__meta' }, formatDateTime(s.at)) : null,
        s.note ? h('div', { class: 'timeline__meta' }, s.note) : null))));
}
