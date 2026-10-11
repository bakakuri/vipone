// Split layout for sign-in, registration and email-link pages.
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { languageSwitcher } from '../navigation/language-switcher.js';
import { themeSwitcher } from '../navigation/theme-switcher.js';
import { brand } from './brand.js';
import { demoBanner } from './demo-banner.js';
import { orbitArt } from './orbit-art.js';

export function mountAuthShell({ config }) {
  const main = document.getElementById('main');
  const shell = h('div', { class: 'auth-shell' });
  main.parentNode.insertBefore(shell, main);
  main.classList.add('auth-shell__content');
  const aside = h('aside', { class: 'auth-shell__aside' },
    orbitArt(),
    brand('/'),
    h('div', { class: 'auth-shell__quote' },
      h('h2', {}, t('auth:aside.title')),
      h('p', {}, t('auth:aside.text'))),
    h('p', { class: 'text-xs text-subtle' }, t('common:footer.riskNotice')));
  const column = h('div', { class: 'auth-shell__main' },
    h('div', { class: 'auth-shell__top' }, languageSwitcher(), themeSwitcher()),
    main,
    h('nav', { class: 'auth-shell__legal cluster', 'aria-label': t('navigation:legal') },
      h('a', { href: '/legal/terms' }, t('navigation:terms')),
      h('a', { href: '/legal/privacy' }, t('navigation:privacy')),
      h('a', { href: '/help' }, t('navigation:help'))));
  shell.append(aside, column);
  const banner = demoBanner(config);
  if (banner) document.body.prepend(banner);
}
