// Contact: the support address from the server configuration and the
// in-account support channel. No contact details are hard-coded.
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { t } from '../i18n/i18n.js';

definePage({
  id: 'contact',
  area: 'public',
  namespaces: ['public'],
  title: 'public:contact.metaTitle',
  render({ page, config, user }) {
    const slot = page.querySelector('#contact-email');
    if (slot) {
      replace(slot, config.supportEmail
        ? h('a', { href: `mailto:${config.supportEmail}` }, h('bdi', { dir: 'ltr' }, config.supportEmail))
        : h('span', { class: 'text-muted' }, t('public:contact.emailNotSet')));
    }
    const cta = page.querySelector('#contact-ticket');
    if (cta && user) cta.setAttribute('href', '/support');
  },
});
