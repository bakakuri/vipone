// Crypto address / transaction hash display. Always rendered left-to-right in
// an isolated direction run so Arabic layout never reorders its characters.
import { h, icon } from '../../core/dom.js';
import { shortenMiddle } from '../../formatting/format-address.js';
import { t } from '../../i18n/i18n.js';
import { copyButton } from './copy-button.js';

export function addressBox(value, { label } = {}) {
  return h('div', { class: 'address' }, h('bdi', { class: 'address__value', dir: 'ltr', 'aria-label': label || '' }, value), copyButton(value, { label: t('common:actions.copyAddress') }));
}

export function inlineHash(value, { href, short = true } = {}) {
  if (!value) return h('span', { class: 'text-subtle' }, '—');
  const text = h('bdi', { class: 'mono', dir: 'ltr', title: value }, short ? shortenMiddle(value, 8, 6) : value);
  return h('span', { class: 'address address--inline' },
    href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', title: t('common:actions.openExplorer') }, text, icon('external', { size: 'sm' })) : text,
    copyButton(value),
  );
}
