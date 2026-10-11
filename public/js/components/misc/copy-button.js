import { h, icon, replace } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { copyText } from '../../utils/clipboard.js';
import { toast } from '../notifications/toast.js';

export function copyButton(value, { label, small = true } = {}) {
  const btn = h('button', { class: `btn btn--ghost btn--icon ${small ? 'btn--sm' : ''} copy-button`, type: 'button', 'aria-label': label || t('common:actions.copy'), title: label || t('common:actions.copy') }, icon('copy', { size: 'sm' }));
  btn.addEventListener('click', async () => {
    if (await copyText(value)) {
      btn.classList.add('is-copied');
      replace(btn, icon('check', { size: 'sm' }));
      toast(t('common:copied'), { tone: 'info', duration: 2000 });
      setTimeout(() => {
        btn.classList.remove('is-copied');
        replace(btn, icon('copy', { size: 'sm' }));
      }, 1600);
    }
  });
  return btn;
}
