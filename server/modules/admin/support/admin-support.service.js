import { AppError } from '../../../core/errors.js';
import { getSql, withTransaction } from '../../../db/client.js';
import { camelize } from '../../../utils/camelize.js';
import { audit } from '../../audit/audit.service.js';

export async function listTickets({ status }) {
  const rows = await getSql()`
    select t.*, p.email, a.email as assigned_email,
           (select max(created_at) from app.support_messages m where m.ticket_id = t.id) as last_message_at,
           (select author_is_staff from app.support_messages m where m.ticket_id = t.id order by created_at desc limit 1) as last_from_staff
    from app.support_tickets t join app.profiles p on p.id = t.user_id left join app.profiles a on a.id = t.assigned_to
    where (${status ?? null}::text is null or t.status = ${status ?? null})
    order by t.updated_at desc limit 200`;
  return rows.map(camelize);
}

export async function getTicket(id) {
  const sql = getSql();
  const [ticket] = await sql`
    select t.*, p.email, p.locale from app.support_tickets t join app.profiles p on p.id = t.user_id where t.id = ${id}`;
  if (!ticket) throw new AppError('not_found');
  const messages = await sql`
    select m.id, m.author_is_staff, m.body, m.created_at, p.email as author_email
    from app.support_messages m join app.profiles p on p.id = m.author_id where m.ticket_id = ${id} order by m.created_at`;
  return { ...camelize(ticket), messages: messages.map(camelize) };
}

export async function reply(req, id, body) {
  return withTransaction(async (tx) => {
    const [ticket] = await tx`select * from app.support_tickets where id = ${id} for update`;
    if (!ticket) throw new AppError('not_found');
    const [msg] = await tx`
      insert into app.support_messages (ticket_id, author_id, author_is_staff, body) values (${id}, ${req.auth.userId}, true, ${body})
      returning id, author_is_staff, body, created_at`;
    await tx`update app.support_tickets set status = 'awaiting_user', assigned_to = coalesce(assigned_to, ${req.auth.userId}) where id = ${id}`;
    await tx`select app.notify(${ticket.user_id}, 'support_reply', ${tx.json({ reference: ticket.reference })}, ${`/support?ticket=${id}`})`;
    await audit(tx, req, { action: 'support.replied', entityType: 'support_ticket', entityId: id });
    return camelize(msg);
  });
}

export async function setStatus(req, id, status) {
  return withTransaction(async (tx) => {
    const [row] = await tx`update app.support_tickets set status = ${status} where id = ${id} returning *`;
    if (!row) throw new AppError('not_found');
    await audit(tx, req, { action: 'support.status_changed', entityType: 'support_ticket', entityId: id, after: { status } });
    return camelize(row);
  });
}
