// Password input with show/hide and live policy checklist (same rules as
// the server: public/js/validation/password-rules.js).
import { h, icon, replace } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { checkPassword, PASSWORD_RULES } from '../../validation/password-rules.js';
import { formField } from './form-field.js';

export function passwordField({ label, name = 'password', autocomplete = 'current-password', showRules = false, getEmail, aside, id } = {}) {
  const control = h('input', { class: 'input', type: 'password', name, autocomplete, required: true, maxLength: 128 });
  const toggle = h('button', { class: 'btn btn--ghost btn--icon btn--sm', type: 'button', 'aria-label': t('auth:showPassword'), 'aria-pressed': 'false' }, icon('eye', { size: 'sm' }));
  toggle.addEventListener('click', () => {
    const visible = control.type === 'text';
    control.type = visible ? 'password' : 'text';
    toggle.setAttribute('aria-pressed', String(!visible));
    toggle.setAttribute('aria-label', t(visible ? 'auth:showPassword' : 'auth:hidePassword'));
    replace(toggle, icon(visible ? 'eye' : 'eye-off', { size: 'sm' }));
  });
  const group = h('div', { class: 'input-group' }, control, h('div', { class: 'input-group__addon' }, toggle));
  const field = formField({ label, control, body: group, aside, id });

  if (showRules) {
    const items = [...PASSWORD_RULES.map((r) => r.id), 'not_email'].map((id) => h('li', { dataset: { rule: id } }, icon('check', { size: 'sm' }), t(`auth:passwordRules.${id}`)));
    const list = h('ul', { class: 'password-rules', 'aria-live': 'polite' }, items);
    field.el.append(list);
    const update = () => {
      const failed = checkPassword(control.value, getEmail?.() || '');
      for (const li of items) li.classList.toggle('is-met', control.value.length > 0 && !failed.includes(li.dataset.rule));
    };
    control.addEventListener('input', update);
  }
  return field;
}
