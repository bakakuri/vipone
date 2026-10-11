// In-app notifications. Stored as a type + parameters; the browser renders
// them in the user's current language (locales/*/notifications.json).

import { AppError } from '../../core/errors.js';
import { getSql } from '../../db/client.js';
import { camelize } from '../../utils/camelize.js';
import { pageOf } from '../../utils/schemas.js';

export async function listNotifications(userId, { unread, limit, cursor }) {
  const rows = await getSql()`
    select id, type, params, link, read_at, created_at from app.notifications
    where user_id = ${userId}
      and (${unread ? true : null}::boolean is null or read_at is null)
      and (${cursor?.t ?? null}::timestamptz is null or (created_at, id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by created_at desc, id desc
    limit ${limit + 1}`;
  const page = pageOf(rows, limit);
  return { items: page.items.map(camelize), nextCursor: page.nextCursor };
}

export async function unreadCount(userId) {
  const [row] = await getSql()`select count(*)::int as count from app.notifications where user_id = ${userId} and read_at is null`;
  return { count: row.count };
}

export async function markRead(userId, id) {
  const [row] = await getSql()`
    update app.notifications set read_at = coalesce(read_at, now()) where id = ${id} and user_id = ${userId}
    returning id, read_at`;
  if (!row) throw new AppError('not_found');
  return camelize(row);
}

export async function markAllRead(userId) {
  const rows = await getSql()`update app.notifications set read_at = now() where user_id = ${userId} and read_at is null returning id`;
  return { updated: rows.length };
}
