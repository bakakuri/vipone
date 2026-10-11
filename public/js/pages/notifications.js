// All notifications, newest first; unread ones are marked. Opening one marks
// it read; "Mark all as read" clears the badge everywhere.
import { notificationsApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, icon, replace } from '../core/dom.js';
import { emit } from '../core/events.js';
import { t } from '../i18n/i18n.js';
import { onLive } from '../services/live-connection.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { setBusy } from '../components/forms/form-validation.js';
import { pageHeader } from '../components/misc/page-header.js';
import { segmented } from '../components/misc/tabs.js';
import { notificationItem } from '../components/notifications/notification-item.js';
import { toastError } from '../components/notifications/toast.js';
import { loadMore } from '../components/tables/load-more.js';

definePage({
  id: 'notifications',
  area: 'app',
  namespaces: ['notifications'],
  title: 'notifications:title',
  async render({ page }) {
    let unreadOnly = false;
    const list = h('ul', { class: 'notification-list notification-list--page' });
    const empty = h('div');

    function item(n) {
      const el = notificationItem(n);
      el.addEventListener('click', async (e) => {
        if (n.readAt) return;
        e.preventDefault();
        const href = el.getAttribute('href');
        await notificationsApi.markRead(n.id).catch(() => {});
        emit('notifications:read');
        location.assign(href);
      });
      return h('li', {}, el);
    }

    const more = loadMore({
      onLoad: async (cursor) => {
        const res = await notificationsApi.list({ cursor, unread: unreadOnly ? 'true' : undefined });
        list.append(...res.items.map(item));
        more.setCursor(res.nextCursor);
      },
    });
    async function load() {
      const res = await notificationsApi.list({ unread: unreadOnly ? 'true' : undefined });
      replace(list, res.items.map(item));
      replace(empty, res.items.length ? null : emptyState({ iconName: 'bell', title: t(unreadOnly ? 'notifications:noneUnread' : 'notifications:empty'), text: t('notifications:emptyText') }));
      more.setCursor(res.nextCursor);
    }

    const markAll = h('button', { class: 'btn', type: 'button' }, icon('check', { size: 'sm' }), t('notifications:markAll'));
    markAll.addEventListener('click', async () => {
      setBusy(markAll, true);
      try {
        await notificationsApi.markAllRead();
        emit('notifications:read');
        await load();
      } catch (err) {
        toastError(err);
      } finally {
        setBusy(markAll, false);
      }
    });

    replace(page,
      pageHeader({ title: t('notifications:title'), subtitle: t('notifications:subtitle'), actions: markAll }),
      segmented([{ value: 'all', label: t('notifications:all') }, { value: 'unread', label: t('notifications:unread') }], {
        value: 'all',
        label: t('notifications:filter'),
        onChange: (v) => {
          unreadOnly = v === 'unread';
          load();
        },
      }),
      h('section', { class: 'card card--flush' }, list, empty),
      more.el);
    await load();
    onLive('notification.created', () => load().catch(() => {}));
  },
});
