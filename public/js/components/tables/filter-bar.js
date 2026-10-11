// Filters for history tables. Values are mirrored in the URL so a filtered
// view can be bookmarked or shared.
import { h, icon } from '../../core/dom.js';
import { setQuery } from '../../core/url.js';
import { t } from '../../i18n/i18n.js';
import { debounce } from '../../utils/debounce.js';

export function filterBar({ fields, onChange, syncUrl = true }) {
  const params = new URL(location.href).searchParams;
  const controls = {};
  const els = fields.map((f) => {
    let control;
    const initial = params.get(f.name) ?? f.value ?? '';
    if (f.type === 'select') {
      control = h('select', { class: 'select', name: f.name, id: `filter-${f.name}` },
        h('option', { value: '' }, f.allLabel || t('common:filters.all')),
        f.options.map((o) => h('option', { value: o.value, selected: o.value === initial }, o.label)));
    } else {
      control = h('input', { class: 'input', type: f.type === 'date' ? 'date' : 'search', name: f.name, id: `filter-${f.name}`, value: initial, placeholder: f.placeholder || '' });
    }
    controls[f.name] = control;
    return h('div', { class: 'field' }, h('label', { class: 'field__label', for: `filter-${f.name}` }, f.label), control);
  });
  const values = () => Object.fromEntries(Object.entries(controls).map(([k, c]) => [k, c.value || undefined]));
  const changed = debounce(() => {
    if (syncUrl) setQuery(Object.fromEntries(Object.entries(values()).map(([k, v]) => [k, v ?? null])));
    onChange(values());
  }, 250);
  Object.values(controls).forEach((c) => c.addEventListener(c.tagName === 'SELECT' ? 'change' : 'input', changed));
  const reset = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, icon('x', { size: 'sm' }), t('common:filters.reset'));
  reset.addEventListener('click', () => {
    Object.values(controls).forEach((c) => {
      c.value = '';
    });
    changed();
  });
  return { el: h('div', { class: 'filter-bar' }, els, h('div', { class: 'filter-bar__actions' }, reset)), values };
}
