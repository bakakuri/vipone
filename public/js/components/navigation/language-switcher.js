import { h, icon } from '../../core/dom.js';
import { getLocale, setLocale, t } from '../../i18n/i18n.js';
import { LOCALES } from '../../i18n/locales.js';
import { dropdown } from '../misc/dropdown.js';

export function languageSwitcher({ onChange, compact = false } = {}) {
  const trigger = h('button', { class: `btn btn--ghost ${compact ? 'btn--icon' : 'btn--sm'}`, type: 'button', 'aria-label': t('common:language') }, icon('globe'), compact ? null : h('span', { class: 'hide-mobile' }, LOCALES[getLocale()].name));
  const menu = dropdown({
    trigger,
    content: (api) => [
      h('div', { class: 'dropdown__label' }, t('common:language')),
      ...Object.entries(LOCALES).map(([code, info]) => {
        const item = h('button', { class: 'dropdown__item', type: 'button', role: 'menuitemradio', 'aria-checked': String(code === getLocale()), lang: code, dir: info.dir }, info.name);
        item.addEventListener('click', async () => {
          api.close();
          await setLocale(code);
          onChange?.(code);
        });
        return item;
      }),
    ],
  });
  return menu.root;
}
