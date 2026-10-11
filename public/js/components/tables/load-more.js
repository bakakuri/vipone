// Keyset pagination: "Show more" loads the next page using the server cursor.
import { h } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { setBusy } from '../forms/form-validation.js';

export function loadMore({ onLoad }) {
  const btn = h('button', { class: 'btn btn--sm', type: 'button' }, t('common:actions.showMore'));
  const el = h('div', { class: 'pagination', hidden: true }, btn);
  let cursor = null;
  btn.addEventListener('click', async () => {
    setBusy(btn, true);
    try {
      await onLoad(cursor);
    } finally {
      setBusy(btn, false);
    }
  });
  return {
    el,
    setCursor(next) {
      cursor = next;
      el.hidden = !next;
    },
  };
}
