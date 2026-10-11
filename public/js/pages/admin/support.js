// Support inbox: tickets by status, conversation, staff replies.
import { adminApi } from '../../api/admin-endpoints.js';
import { definePage } from '../../core/page.js';
import { h, replace } from '../../core/dom.js';
import { formatDateTime, formatRelative } from '../../formatting/format-date.js';
import { t } from '../../i18n/i18n.js';
import { liveRefresh } from '../../services/live-refresh.js';
import { actionButton } from '../../components/admin/action-button.js';
import { userLink } from '../../components/admin/admin-ui.js';
import { emptyState } from '../../components/feedback/empty-state.js';
import { errorState } from '../../components/feedback/error-state.js';
import { statusBadge } from '../../components/feedback/status-badge.js';
import { formField, textarea } from '../../components/forms/form-field.js';
import { setBusy, showServerErrors } from '../../components/forms/form-validation.js';
import { pageHeader } from '../../components/misc/page-header.js';
import { segmented } from '../../components/misc/tabs.js';
import { dataTable } from '../../components/tables/data-table.js';

definePage({
  id: 'admin-support',
  area: 'admin',
  auth: 'admin',
  permission: 'support.manage',
  namespaces: ['admin', 'support'],
  title: 'admin:support.title',
  async render({ page }) {
    let status = 'open';
    const detail = h('div');
    const table = dataTable({
      columns: [
        { key: 'subject', label: t('support:subject'), primary: true, render: (tk) => h('span', { class: 'stack stack--sm' }, h('strong', {}, tk.subject), h('span', { class: 'text-xs text-subtle' }, `${tk.reference} · ${t(`support:categories.${tk.category}`)}`)) },
        { key: 'user', label: t('admin:users.email'), render: (tk) => userLink(tk.userId, tk.email) },
        { key: 'status', label: t('admin:users.status'), render: (tk) => h('span', { class: 'stack stack--sm' }, statusBadge(tk.status), tk.lastFromStaff === false ? h('span', { class: 'badge badge--pending' }, t('admin:support.waiting')) : null) },
        { key: 'last', label: t('admin:support.lastMessage'), render: (tk) => (tk.lastMessageAt ? formatRelative(tk.lastMessageAt) : '—') },
      ],
      onRowClick: (tk) => open(tk.id),
      empty: emptyState({ iconName: 'support', title: t('admin:support.none') }),
    });

    async function load() {
      table.update(await adminApi.tickets(status));
    }

    async function open(id) {
      replace(detail, h('div', { class: 'card' }, t('common:loading')));
      try {
        const tk = await adminApi.ticket(id);
        const reply = formField({ label: t('admin:support.reply'), control: textarea({ rows: 4 }), hint: t('admin:support.replyHint'), id: 'staff-reply' });
        const send = h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, t('support:sendReply'));
        const form = h('form', { class: 'form', novalidate: true }, reply.el, h('div', { class: 'cluster' }, send,
          ['open', 'awaiting_user'].includes(tk.status) ? actionButton(t('admin:support.resolve'), { run: () => adminApi.ticketStatus(id, 'resolved'), onDone: () => { open(id); load(); } }) : null,
          tk.status !== 'closed' ? actionButton(t('admin:support.close'), { tone: 'ghost', confirm: t('admin:support.closeText'), run: () => adminApi.ticketStatus(id, 'closed'), onDone: () => { open(id); load(); } }) : null));
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          setBusy(send, true);
          try {
            await adminApi.replyTicket(id, reply.control.value);
            open(id);
            load();
          } catch (err) {
            showServerErrors(err, { body: reply });
          } finally {
            setBusy(send, false);
          }
        });
        replace(detail, h('section', { class: 'card', 'aria-labelledby': 'ticket-title' },
          h('div', { class: 'card__header' }, h('div', { class: 'stack stack--sm' }, h('h2', { class: 'card__title', id: 'ticket-title' }, tk.subject),
            h('span', { class: 'text-xs text-subtle' }, `${tk.reference} · `, userLink(tk.userId, tk.email), ` · ${tk.locale}`)), statusBadge(tk.status)),
          h('ol', { class: 'ticket-thread' }, tk.messages.map((m) => h('li', { class: `ticket-message ${m.authorIsStaff ? 'ticket-message--staff' : 'ticket-message--user'}` },
            h('div', { class: 'ticket-message__meta' }, m.authorIsStaff ? `${t('support:staff')} · ${m.authorEmail || ''}` : tk.email, ' · ', formatDateTime(m.createdAt)),
            h('div', { class: 'ticket-message__body' }, m.body)))),
          tk.status === 'closed' ? null : form));
        detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        replace(detail, errorState(err));
      }
    }

    replace(page,
      pageHeader({ title: t('admin:support.title'), subtitle: t('admin:support.subtitle') }),
      segmented(['open', 'awaiting_user', 'resolved', 'closed'].map((s) => ({ value: s, label: t(`common:status.${s}`) })), { value: status, label: t('admin:support.filter'), onChange: (v) => { status = v; load(); } }),
      table.el, detail);
    await load();
    liveRefresh(['support.ticket_created'], () => load().catch(() => {}));
  },
});
