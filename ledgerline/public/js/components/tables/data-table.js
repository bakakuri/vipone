// Responsive data table: a real <table> on wide screens, stacked cards on
// phones (labels from data-label). Rows highlight briefly when they are new
// or changed by a live update.
import { h, replace } from '../../core/dom.js';
import { prefersReducedMotion } from '../../animations/motion.js';

export function dataTable({ columns, rows = [], rowKey = (r) => r.id, onRowClick, empty, caption } = {}) {
  const thead = h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', class: [c.align === 'end' ? 'col-num' : '', c.className].filter(Boolean).join(' ') }, c.label))));
  const tbody = h('tbody');
  const table = h('table', { class: 'table table--responsive' }, caption ? h('caption', { class: 'visually-hidden' }, caption) : null, thead, tbody);
  const wrap = h('div', { class: 'table-wrap' }, table);
  const root = h('div', {}, wrap);
  let known = new Map();

  function renderRow(row, isNew) {
    const tr = h('tr', { class: [onRowClick ? 'is-clickable' : '', isNew ? 'is-new' : ''].filter(Boolean).join(' ') || undefined, dataset: { key: String(rowKey(row)) } },
      columns.map((c) => {
        const content = c.render ? c.render(row) : row[c.key];
        return h('td', {
          'data-label': c.label,
          class: [c.align === 'end' ? 'col-num' : '', c.primary ? 'col-primary' : '', c.actions ? 'col-actions' : '', c.className].filter(Boolean).join(' ') || undefined,
        }, content ?? '—');
      }),
    );
    if (onRowClick) {
      tr.tabIndex = 0;
      tr.addEventListener('click', (e) => {
        if (!e.target.closest('a, button')) onRowClick(row);
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onRowClick(row);
      });
    }
    return tr;
  }

  function update(nextRows, { append = false } = {}) {
    const previous = known;
    known = new Map();
    const signature = (r) => JSON.stringify(r);
    const trs = nextRows.map((r) => {
      const key = String(rowKey(r));
      const sig = signature(r);
      const changed = previous.size > 0 && previous.get(key) !== sig && !prefersReducedMotion();
      known.set(key, sig);
      return renderRow(r, changed);
    });
    if (append) tbody.append(...trs);
    else replace(tbody, trs);
    wrap.hidden = nextRows.length === 0 && !append;
    root.querySelector(':scope > .empty-state')?.remove();
    if (!nextRows.length && !append && empty) root.append(empty);
  }

  update(rows); // the first render never highlights rows
  return { el: root, update, table };
}
