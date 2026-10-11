// Application shell for signed-in pages (user and admin areas): sidebar,
// top bar with live status, language/theme switchers, notifications,
// profile menu, mobile bottom navigation and drawer.
import { h, icon } from '../../core/dom.js';
import { trapFocus } from '../../core/focus-trap.js';
import { ADMIN_NAV, MOBILE_NAV, USER_NAV, isCurrent } from '../../core/navigation.js';
import { can } from '../../auth/session.js';
import { t } from '../../i18n/i18n.js';
import { liveIndicator } from '../feedback/live-indicator.js';
import { languageSwitcher } from '../navigation/language-switcher.js';
import { notificationBell } from '../navigation/notification-bell.js';
import { profileMenu } from '../navigation/profile-menu.js';
import { themeSwitcher } from '../navigation/theme-switcher.js';
import { brand } from './brand.js';
import { demoBanner } from './demo-banner.js';

function navLink(item) {
  return h('a', { class: 'nav-link', href: item.href, 'aria-current': isCurrent(item.href) ? 'page' : undefined, dataset: item.tour ? { tour: item.tour } : undefined },
    icon(item.icon), h('span', {}, t(item.label)));
}

function navGroups(area) {
  if (area === 'admin') {
    return [h('nav', { class: 'nav-group', 'aria-label': t('admin:nav.title') }, ADMIN_NAV.filter((i) => can(i.permission)).map(navLink))];
  }
  return [
    h('nav', { class: 'nav-group', 'aria-label': t('navigation:main') }, USER_NAV.main.map(navLink)),
    h('nav', { class: 'nav-group', 'aria-label': t('navigation:account') }, h('div', { class: 'nav-group__title' }, t('navigation:account')), USER_NAV.account.map(navLink)),
  ];
}

function footer() {
  const year = new Date().getFullYear();
  return h('footer', { class: 'app-footer' },
    h('span', {}, t('common:footer.copyright', { year })),
    h('nav', { 'aria-label': t('navigation:legal') },
      h('a', { href: '/legal/terms' }, t('navigation:terms')),
      h('a', { href: '/legal/privacy' }, t('navigation:privacy')),
      h('a', { href: '/risk-disclosure' }, t('navigation:risk')),
      h('a', { href: '/sitemap' }, t('navigation:sitemap'))),
  );
}

function openDrawer(area) {
  const backdrop = h('div', { class: 'drawer-backdrop' });
  const close = h('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': t('common:actions.close') }, icon('x'));
  const drawer = h('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('navigation:menu') },
    h('div', { class: 'cluster cluster--between' }, brand(area === 'admin' ? '/admin' : '/dashboard'), close),
    ...navGroups(area));
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

export function mountAppShell({ area = 'user', config, title }) {
  const main = document.getElementById('main');
  const shell = h('div', { class: 'app-shell' });
  main.classList.add('app-main');
  main.parentNode.insertBefore(shell, main);

  const sidebar = h('aside', { class: 'sidebar', 'aria-label': t('navigation:sidebar') },
    h('div', { class: 'cluster' }, brand(area === 'admin' ? '/admin' : '/dashboard'), area === 'admin' ? h('span', { class: 'admin-badge' }, t('admin:badge')) : null),
    ...navGroups(area));

  const menuBtn = h('button', { class: 'btn btn--ghost btn--icon topbar__menu', type: 'button', 'aria-label': t('navigation:menu') }, icon('menu'));
  menuBtn.addEventListener('click', () => openDrawer(area));
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'topbar__start' }, menuBtn, h('span', { class: 'topbar__brand' }, brand(area === 'admin' ? '/admin' : '/dashboard')), h('span', { class: 'topbar__title' }, title || '')),
    h('div', { class: 'topbar__end' }, liveIndicator(), notificationBell(), languageSwitcher({ compact: true }), themeSwitcher(), profileMenu({ admin: area === 'admin' })));

  shell.append(sidebar, topbar, main);
  main.append(footer());

  const banner = demoBanner(config);
  if (banner) document.body.prepend(banner);

  if (area !== 'admin') {
    const items = USER_NAV.main.filter((i) => MOBILE_NAV.includes(i.href));
    const more = h('button', { type: 'button', 'aria-label': t('navigation:more') }, icon('menu'), h('span', {}, t('navigation:more')));
    more.addEventListener('click', () => openDrawer(area));
    document.body.append(h('nav', { class: 'mobile-nav', 'aria-label': t('navigation:mobile') },
      items.map((i) => h('a', { href: i.href, 'aria-current': isCurrent(i.href) ? 'page' : undefined }, icon(i.icon), h('span', {}, t(i.label)))), more));
  }
  return { shell, topbar };
}
