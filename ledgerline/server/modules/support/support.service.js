// Support tickets between a user and the support team.

import { AppError } from '../../core/errors.js';
import { getSql, withTransaction } from '../../db/client.js';
import { camelize } from '../../utils/camelize.js';

export async function listTickets(userId) {
  const rows = await getSql()`
    select t.id, t.reference, t.subject, t.category, t.status, t.created_at, t.updated_at,
           (select count(*)::int from app.support_messages m where m.ticket_id = t.id) as message_count
    from app.support_tickets t where t.user_id = ${userId} order by t.updated_at desc limit 100`;
  return rows.map(camelize);
}

export async function createTicket(userId, { subject, category, message }) {
  return withTransaction(async (tx) => {
    const [ticket] = await tx`
      insert into app.support_tickets (user_id, subject, category) values (${userId}, ${subject}, ${category})
      returning id, reference, subject, category, status, created_at, updated_at`;
    await tx`
      insert into app.support_messages (ticket_id, author_id, author_is_staff, body)
      values (${ticket.id}, ${userId}, false, ${message})`;
    await tx`select app.emit_event('admin:ops', 'support.ticket_created', ${tx.json({ id: ticket.id })})`;
    return camelize(ticket);
  });
}

export async function getTicket(userId, id) {
  const sql = getSql();
  const [ticket] = await sql`
    select id, reference, subject, category, status, created_at, updated_at from app.support_tickets
    where id = ${id} and user_id = ${userId}`;
  if (!ticket) throw new AppError('not_found');
  const messages = await sql`
    select id, author_is_staff, body, created_at from app.support_messages where ticket_id = ${id} order by created_at`;
  return { ...camelize(ticket), messages: messages.map(camelize) };
}

export async function addMessage(userId, id, body) {
  return withTransaction(async (tx) => {
    const [ticket] = await tx`select id, status from app.support_tickets where id = ${id} and user_id = ${userId} for update`;
    if (!ticket) throw new AppError('not_found');
    if (ticket.status === 'closed') throw new AppError('ticket_closed', { status: 409 });
    const [msg] = await tx`
      insert into app.support_messages (ticket_id, author_id, author_is_staff, body)
      values (${id}, ${userId}, false, ${body}) returning id, author_is_staff, body, created_at`;
    await tx`update app.support_tickets set status = 'open' where id = ${id}`;
    return camelize(msg);
  });
}
