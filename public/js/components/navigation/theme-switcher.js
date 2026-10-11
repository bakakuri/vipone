import { h, icon, replace } from '../../core/dom.js';
import { listen } from '../../core/events.js';
import { t } from '../../i18n/i18n.js';
import { getThemePreference, resolvedTheme, setTheme } from '../../themes/theme.js';
import { dropdown } from '../misc/dropdown.js';

const OPTIONS = [
  { value: 'light', icon: 'sun' },
  { value: 'dark', icon: 'moon' },
  { value: 'system', icon: 'monitor' },
];

export function themeSwitcher({ onChange } = {}) {
  const trigger = h('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': t('common:theme.label') });
  const paint = () => replace(trigger, icon(resolvedTheme() === 'dark' ? 'moon' : 'sun'));
  paint();
  listen('theme:changed', paint);
  const menu = dropdown({
    trigger,
    content: (api) => [
      h('div', { class: 'dropdown__label' }, t('common:theme.label')),
      ...OPTIONS.map((o) => {
        const item = h('button', { class: 'dropdown__item', type: 'button', role: 'menuitemradio', 'aria-checked': String(getThemePreference() === o.value) }, icon(o.icon, { size: 'sm' }), t(`common:theme.${o.value}`));
        item.addEventListener('click', () => {
          api.close();
          setTheme(o.value);
          onChange?.(o.value);
        });
        return item;
      }),
    ],
  });
  return menu.root;
}
