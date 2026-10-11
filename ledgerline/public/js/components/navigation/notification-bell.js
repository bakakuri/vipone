// Bell with unread count; opens the latest notifications. Updates when the
// server signals a new notification.
import { notificationsApi } from '../../api/endpoints.js';
import { h, icon, replace } from '../../core/dom.js';
import { t } from '../../i18n/i18n.js';
import { onLive } from '../../services/live-connection.js';
import { dropdown } from '../misc/dropdown.js';
import { notificationItem } from '../notifications/notification-item.js';
import { pulseClass } from '../../animations/motion.js';
import { listen } from '../../core/events.js';

export function notificationBell() {
  const count = h('span', { class: 'count-badge', hidden: true });
  const trigger = h('button', { class: 'btn btn--ghost btn--icon bell', type: 'button', 'aria-label': t('navigation:notifications') }, icon('bell'), count);
  const list = h('div');
  const menu = dropdown({
    trigger,
    className: 'notification-panel',
    content: () => [
      h('div', { class: 'notification-panel__header' }, h('strong', {}, t('navigation:notifications')), h('a', { href: '/notifications', class: 'text-small' }, t('common:actions.viewAll'))),
      list,
    ],
    onOpen: load,
  });

  async function refreshCount() {
    try {
      const { count: n } = await notificationsApi.unreadCount();
      count.hidden = n === 0;
      count.textContent = n > 99 ? '99+' : String(n);
      trigger.setAttribute('aria-label', `${t('navigation:notifications')} (${n})`);
    } catch {
      /* the count is decorative; failures are ignored */
    }
  }

  async function load() {
    replace(list, h('div', { class: 'empty-state' }, h('span', { class: 'skeleton skeleton--row w-full' })));
    const data = await notificationsApi.list({ limit: 6 });
    replace(list, data.items.length
      ? h('ul', { class: 'notification-list' }, data.items.map((n) => h('li', {}, notificationItem(n))))
      : h('div', { class: 'empty-state' }, t('notifications:empty')));
  }

  refreshCount();
  listen('notifications:read', refreshCount);
  onLive('notification.created', () => {
    refreshCount();
    pulseClass(count, 'is-changed', 600);
    if (!menu.menu.hidden) load();
  });
  return menu.root;
}
