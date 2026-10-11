// Transactional outbox for emails: queued inside the business transaction,
// delivered right after it commits, retried by the dispatch job on failure.

import { logger } from '../../core/logger.js';
import { getSql } from '../../db/client.js';
import { getEmailProvider } from '../../integrations/email/index.js';
import { renderEmail } from '../../integrations/email/render-email.js';

export async function queueEmail(db, { to, template, locale = 'en', params = {} }) {
  const [row] = await db`
    insert into app.email_outbox (to_email, template, locale, params)
    values (${to}, ${template}, ${locale}, ${db.json(params)})
    returning id`;
  return row.id;
}

export async function dispatchPendingEmails({ limit = 20 } = {}) {
  const sql = getSql();
  const batch = await sql.begin(async (tx) => {
    const rows = await tx`
      select id, to_email, template, locale, params, attempts from app.email_outbox
      where status in ('queued', 'failed') and attempts < 6 and send_after <= now()
      order by created_at
      limit ${limit}
      for update skip locked`;
    if (rows.length) await tx`update app.email_outbox set status = 'sending' where id in ${tx(rows.map((r) => r.id))}`;
    return rows;
  });

  let sent = 0;
  for (const row of batch) {
    try {
      const message = renderEmail(row.template, row.locale, row.params);
      const result = await getEmailProvider().send({ to: row.to_email, ...message });
      await sql`
        update app.email_outbox set status = 'sent', sent_at = now(), attempts = attempts + 1, provider_message_id = ${result.id ?? null}
        where id = ${row.id}`;
      sent += 1;
    } catch (err) {
      const backoffMinutes = 2 ** row.attempts;
      await sql`
        update app.email_outbox
        set status = 'failed', attempts = attempts + 1, last_error = ${String(err.message).slice(0, 500)},
            send_after = now() + ${`${backoffMinutes} minutes`}::interval
        where id = ${row.id}`;
      logger.warn('email_send_failed', { template: row.template, error: err.message });
    }
  }
  return { processed: batch.length, sent };
}

// Best-effort immediate delivery after a request; failures stay queued.
export function dispatchSoon() {
  return dispatchPendingEmails({ limit: 10 }).catch((err) => logger.warn('email_dispatch_error', { error: err.message }));
}
