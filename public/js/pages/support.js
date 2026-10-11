// Support: open a ticket, follow the conversation with staff. Staff never ask
// for passwords, codes, private keys or seed phrases — the page says so.
import { supportApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { h, replace } from '../core/dom.js';
import { query, setQuery } from '../core/url.js';
import { formatDateTime, formatRelative } from '../formatting/format-date.js';
import { t } from '../i18n/i18n.js';
import { alertBox } from '../components/feedback/alert.js';
import { emptyState } from '../components/feedback/empty-state.js';
import { errorState } from '../components/feedback/error-state.js';
import { statusBadge } from '../components/feedback/status-badge.js';
import { formField, input, select, textarea } from '../components/forms/form-field.js';
import { setBusy, showServerErrors } from '../components/forms/form-validation.js';
import { pageHeader } from '../components/misc/page-header.js';
import { toast } from '../components/notifications/toast.js';

const CATEGORIES = ['account', 'deposit', 'withdrawal', 'investment', 'referral', 'security', 'other'];

function messageBubble(m) {
  return h('li', { class: `ticket-message ${m.authorIsStaff ? 'ticket-message--staff' : 'ticket-message--user'}` },
    h('div', { class: 'ticket-message__meta' }, m.authorIsStaff ? t('support:staff') : t('support:you'), ' ', h('time', { datetime: m.createdAt, title: formatDateTime(m.createdAt) }, formatRelative(m.createdAt))),
    h('div', { class: 'ticket-message__body' }, m.body));
}

definePage({
  id: 'support',
  area: 'app',
  namespaces: ['support'],
  title: 'support:title',
  async render({ page }) {
    const listSlot = h('div', { class: 'stack stack--sm' });
    const detailSlot = h('div');

    const subject = formField({ label: t('support:subject'), control: input({ name: 'subject', maxLength: 140 }), id: 'ticket-subject' });
    const category = formField({ label: t('support:category'), control: select(CATEGORIES.map((c) => ({ value: c, label: t(`support:categories.${c}`) })), { name: 'category' }), id: 'ticket-category' });
    const message = formField({ label: t('support:message'), control: textarea({ name: 'message', rows: 6, maxLength: 5000 }), hint: t('support:messageHint'), id: 'ticket-message' });
    const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, t('support:send'));
    const form = h('form', { class: 'form', novalidate: true }, subject.el, category.el, message.el, h('div', { class: 'cluster' }, submit));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setBusy(submit, true);
      try {
        const ticket = await supportApi.create({ subject: subject.control.value, category: category.control.value, message: message.control.value });
        form.reset();
        toast(t('support:created', { reference: ticket.reference }));
        await loadList();
        openTicket(ticket.id);
      } catch (err) {
        showServerErrors(err, { subject, category, message });
      } finally {
        setBusy(submit, false);
      }
    });

    async function openTicket(id) {
      setQuery({ ticket: id });
      replace(detailSlot, h('div', { class: 'card' }, t('common:loading')));
      try {
        const ticket = await supportApi.ticket(id);
        const reply = formField({ label: t('support:reply'), control: textarea({ name: 'body', rows: 3, maxLength: 5000 }), id: 'ticket-reply' });
        const send = h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, t('support:sendReply'));
        const replyForm = h('form', { class: 'form', novalidate: true }, reply.el, h('div', { class: 'cluster' }, send));
        const messages = h('ol', { class: 'ticket-thread' }, ticket.messages.map(messageBubble));
        replyForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          setBusy(send, true);
          try {
            const msg = await supportApi.reply(id, reply.control.value);
            messages.append(messageBubble(msg));
            reply.control.value = '';
          } catch (err) {
            showServerErrors(err, { body: reply });
          } finally {
            setBusy(send, false);
          }
        });
        replace(detailSlot, h('section', { class: 'card', 'aria-labelledby': 'ticket-title' },
          h('div', { class: 'card__header' },
            h('div', { class: 'stack stack--sm' }, h('h2', { class: 'card__title', id: 'ticket-title' }, ticket.subject),
              h('span', { class: 'text-xs text-subtle' }, h('bdi', { class: 'mono', dir: 'ltr' }, ticket.reference), ` · ${t(`support:categories.${ticket.category}`)}`)),
            statusBadge(ticket.status)),
          messages,
          ticket.status === 'closed' ? h('p', { class: 'text-small text-muted' }, t('support:closedNote')) : replyForm));
      } catch (err) {
        replace(detailSlot, errorState(err));
      }
    }

    async function loadList() {
      const tickets = await supportApi.tickets();
      replace(listSlot, tickets.length
        ? tickets.map((tk) => h('button', { class: 'ticket-row', type: 'button', on: { click: () => openTicket(tk.id) } },
            h('span', { class: 'ticket-row__main' }, h('strong', {}, tk.subject), h('span', { class: 'text-xs text-subtle' }, `${tk.reference} · ${formatRelative(tk.updatedAt)}`)),
            statusBadge(tk.status)))
        : emptyState({ iconName: 'support', title: t('support:noTickets'), text: t('support:noTicketsText') }));
    }

    replace(page,
      pageHeader({ title: t('support:title'), subtitle: t('support:subtitle'), actions: h('a', { class: 'btn', href: '/help' }, t('navigation:help')) }),
      alertBox({ tone: 'warning', title: t('support:safetyTitle'), text: t('support:safetyText') }),
      h('div', { class: 'grid grid--2' },
        h('section', { class: 'card', 'aria-labelledby': 'new-ticket-title' }, h('h2', { class: 'card__title', id: 'new-ticket-title' }, t('support:newTicket')), form),
        h('section', { class: 'stack', 'aria-labelledby': 'tickets-title' }, h('h2', { class: 'section-title', id: 'tickets-title' }, t('support:yourTickets')), listSlot)),
      detailSlot);
    await loadList();
    if (query('ticket')) openTicket(query('ticket'));
  },
});
