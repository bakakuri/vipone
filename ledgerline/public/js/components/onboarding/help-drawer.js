// Contextual help: explains the current page without leaving it. Texts come
// from locales/*/help.json (pages.<pageId>.topics).
import { h, icon } from '../../core/dom.js';
import { trapFocus } from '../../core/focus-trap.js';
import { raw, t } from '../../i18n/i18n.js';

export function openHelp(pageId) {
  const topics = raw(`help:pages.${pageId}.topics`) || [];
  const backdrop = h('div', { class: 'drawer-backdrop' });
  const close = h('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': t('common:actions.close') }, icon('x'));
  const drawer = h('aside', { class: 'help-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title' },
    h('div', { class: 'help-drawer__header' }, h('h2', { id: 'help-title', class: 'modal__title' }, t(`help:pages.${pageId}.title`)), close),
    h('div', { class: 'help-drawer__body' },
      topics.map((topic) => h('section', { class: 'help-topic' }, h('h3', {}, topic.title), ...[].concat(topic.body).map((p) => h('p', {}, p)))),
      h('a', { class: 'btn btn--sm', href: '/help' }, icon('book', { size: 'sm' }), t('help:openHelpCenter'))));
  document.body.append(backdrop, drawer);
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    drawer.classList.add('is-open');
  });
  let release;
  const dismiss = () => {
    backdrop.classList.remove('is-open');
    drawer.classList.remove('is-open');
    release?.();
    setTimeout(() => {
      backdrop.remove();
      drawer.remove();
    }, 300);
  };
  release = trapFocus(drawer, { onEscape: dismiss });
  backdrop.addEventListener('click', dismiss);
  close.addEventListener('click', dismiss);
}

export function helpButton(pageId) {
  const btn = h('button', { class: 'btn btn--sm', type: 'button', dataset: { tour: 'page-help' } }, icon('help', { size: 'sm' }), t('help:button'));
  btn.addEventListener('click', () => openHelp(pageId));
  return btn;
}
