// Labelled field with hint and error slot, wired for screen readers.
import { h } from '../../core/dom.js';

let seq = 0;

export function formField({ label, control, body, hint, aside, id } = {}) {
  // `body` is what is shown (e.g. an input group wrapping `control`).
  const fieldId = id || control.id || `f-${(seq += 1)}`;
  control.id = fieldId;
  const hintId = hint ? `${fieldId}-hint` : null;
  const errorId = `${fieldId}-error`;
  control.setAttribute('aria-describedby', [hintId, errorId].filter(Boolean).join(' '));
  const error = h('div', { class: 'field__error', id: errorId, role: 'alert' });
  const root = h('div', { class: 'field' },
    h('label', { class: 'field__label', for: fieldId }, h('span', {}, label), aside ? h('span', { class: 'field__label-aside' }, aside) : null),
    body || control,
    hint ? h('div', { class: 'field__hint', id: hintId }, hint) : null,
    error,
  );
  return {
    el: root,
    control,
    setError(message) {
      error.textContent = message || '';
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    },
  };
}

export function input(attrs = {}) {
  return h('input', { class: `input ${attrs.mono ? 'input--mono' : ''}`.trim(), ...attrs, mono: undefined });
}

export function select(options, attrs = {}) {
  return h('select', { class: 'select', ...attrs }, options.map((o) => h('option', { value: o.value, selected: o.value === attrs.value }, o.label)));
}

export function textarea(attrs = {}) {
  return h('textarea', { class: 'textarea', ...attrs });
}

export function checkbox({ label, name, checked = false, required = false }) {
  const box = h('input', { type: 'checkbox', name, checked, required });
  return { el: h('label', { class: 'checkbox' }, box, h('span', {}, label)), input: box };
}
