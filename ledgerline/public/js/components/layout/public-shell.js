// Header and footer for public pages.
import { h, icon } from '../../core/dom.js';
import { trapFocus } from '../../core/focus-trap.js';
import { PUBLIC_NAV, isCurrent } from '../../core/navigation.js';
import { currentUser } from '../../auth/session.js';
import { t } from '../../i18n/i18n.js';
import { languageSwitcher } from '../navigation/language-switcher.js';
import { themeSwitcher } from '../navigation/theme-switcher.js';
import { brand } from './brand.js';
import { demoBanner } from './demo-banner.js';

function accountActions() {
  const user = currentUser();
  if (user) return [h('a', { class: 'btn btn--primary btn--sm', href: user.roles?.length ? '/admin' : '/dashboard' }, t('navigation:openAccount'))];
  return [
    h('a', { class: 'btn btn--ghost btn--sm btn--hide-mobile', href: '/login' }, t('navigation:signIn')),
    h('a', { class: 'btn btn--primary btn--sm', href: '/register' }, t('navigation:register')),
  ];
}

function openMenu() {
  const backdrop = h('div', { class: 'drawer-backdrop' });
  const close = h('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': t('common:actions.close') }, icon('x'));
  const drawer = h('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('navigation:menu') },
    h('div', { class: 'cluster cluster--between' }, brand('/'), close),
    h('nav', { class: 'nav-group' }, [{ href: '/', label: 'navigation:home' }, ...PUBLIC_NAV, { href: '/help', label: 'navigation:help' }].map((i) =>
      h('a', { class: 'nav-link', href: i.href, 'aria-current': isCurrent(i.href) ? 'page' : undefined }, t(i.label)))),
    h('div', { class: 'cluster drawer__prefs' }, languageSwitcher(), themeSwitcher()),
    h('div', { class: 'stack stack--sm' }, currentUser() ? null : h('a', { class: 'btn btn--block', href: '/login' }, t('navigation:signIn')), ...accountActions().map((a) => {
      a.classList.add('btn--block');
      a.classList.remove('btn--sm', 'btn--hide-mobile');
      return a;
    })));
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

export function mountPublicShell({ config }) {
  const main = document.getElementById('main');
  main.classList.add('public-main');
  const menu = h('button', { class: 'btn btn--ghost btn--icon public-header__menu', type: 'button', 'aria-label': t('navigation:menu') }, icon('menu'));
  menu.addEventListener('click', openMenu);
  const header = h('header', { class: 'public-header' },
    h('div', { class: 'public-header__inner' },
      brand('/'),
      h('nav', { class: 'public-nav', 'aria-label': t('navigation:main') }, PUBLIC_NAV.map((i) => h('a', { href: i.href, 'aria-current': isCurrent(i.href) ? 'page' : undefined }, t(i.label)))),
      h('div', { class: 'public-header__actions' }, h('span', { class: 'public-header__prefs' }, languageSwitcher({ compact: true }), themeSwitcher()), ...accountActions(), menu)));
  main.parentNode.insertBefore(header, main);

  const year = new Date().getFullYear();
  const col = (title, links) => h('div', {}, h('h2', {}, title), h('ul', {}, links.map(([href, label]) => h('li', {}, h('a', { href }, label)))));
  const footerEl = h('footer', { class: 'public-footer' },
    h('div', { class: 'public-footer__inner' },
      h('div', { class: 'stack stack--sm' }, brand('/'), h('p', { class: 'text-small text-muted' }, t('common:footer.tagline'))),
      col(t('navigation:platform'), [['/how-it-works', t('navigation:howItWorks')], ['/products', t('navigation:products')], ['/faq', t('navigation:faq')], ['/help', t('navigation:help')]]),
      col(t('navigation:legal'), [['/legal/terms', t('navigation:terms')], ['/legal/privacy', t('navigation:privacy')], ['/legal/cookies', t('navigation:cookies')], ['/risk-disclosure', t('navigation:risk')]]),
      col(t('navigation:company'), [['/contact', t('navigation:contact')], ['/sitemap', t('navigation:sitemap')]])),
    h('div', { class: 'public-footer__note' },
      h('p', {}, t('common:footer.riskNotice')),
      h('p', {}, t('common:footer.copyright', { year }))));
  main.after(footerEl);
  const banner = demoBanner(config);
  if (banner) document.body.prepend(banner);
}
