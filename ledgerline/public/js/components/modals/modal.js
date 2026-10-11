// Accessible modal dialog: focus trap, Escape to close, scroll lock,
// enter/leave transition. Content is built with DOM nodes, never HTML strings.
import { h, icon } from '../../core/dom.js';
import { trapFocus } from '../../core/focus-trap.js';
import { t } from '../../i18n/i18n.js';

let openCount = 0;

export function openModal({ title, body, footer, wide = false, onClose, dismissible = true } = {}) {
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  const closeBtn = dismissible ? h('button', { class: 'btn btn--ghost btn--icon btn--sm', type: 'button', 'aria-label': t('common:actions.close') }, icon('x')) : null;
  const bodyEl = h('div', { class: 'modal__body' }, body);
  const footerEl = footer ? h('div', { class: 'modal__footer' }, footer) : null;
  const dialog = h('div', { class: `modal${wide ? ' modal--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'modal__header' }, h('h2', { class: 'modal__title', id: titleId }, title), closeBtn),
    bodyEl,
    footerEl,
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog);
  let releaseFocus;
  let closed = false;

  function close(result) {
    if (closed) return;
    closed = true;
    backdrop.classList.remove('is-open');
    releaseFocus?.();
    openCount -= 1;
    if (openCount <= 0) document.body.classList.remove('has-modal');
    setTimeout(() => backdrop.remove(), 200);
    onClose?.(result);
  }

  closeBtn?.addEventListener('click', () => close());
  if (dismissible) backdrop.addEventListener('mousedown', (e) => e.target === backdrop && close());
  document.body.append(backdrop);
  openCount += 1;
  document.body.classList.add('has-modal');
  requestAnimationFrame(() => backdrop.classList.add('is-open'));
  releaseFocus = trapFocus(dialog, { onEscape: dismissible ? () => close() : undefined });

  return { close, dialog, body: bodyEl, footer: footerEl, setBody: (node) => bodyEl.replaceChildren(node) };
}
