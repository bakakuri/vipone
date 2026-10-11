import { h, icon } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { currentUser, signOut } from '../../auth/session.js';
import { dropdown } from '../misc/dropdown.js';

export function profileMenu({ admin = false } = {}) {
  const user = currentUser();
  const initial = (user?.displayName || user?.email || '?').slice(0, 1).toUpperCase();
  const trigger = h('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': t('navigation:accountMenu') },
    h('span', { class: 'avatar', 'aria-hidden': 'true' }, initial));
  const link = (href, iconName, label) => h('a', { class: 'dropdown__item', href }, icon(iconName, { size: 'sm' }), label);
  const menu = dropdown({
    trigger,
    content: () => [
      h('div', { class: 'dropdown__label' }, h('bdi', {}, user?.email || '')),
      link('/profile', 'user', t('navigation:profile')),
      link('/security', 'shield', t('navigation:security')),
      user?.roles?.length ? (admin ? link('/dashboard', 'dashboard', t('navigation:userArea')) : link('/admin', 'gauge', t('navigation:adminArea'))) : null,
      link('/help', 'help', t('navigation:help')),
      h('div', { class: 'dropdown__divider' }),
      (() => {
        const b = h('button', { class: 'dropdown__item', type: 'button' }, icon('logout', { size: 'sm' }), t('navigation:signOut'));
        b.addEventListener('click', signOut);
        return b;
      })(),
    ].filter(Boolean),
  });
  return menu.root;
}
