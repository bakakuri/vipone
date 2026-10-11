// Append-only audit log for every significant staff or security action.

import { getConfig } from '../../config/env.js';
import { clientIpHash, userAgent } from '../../middleware/client-ip.js';

export async function audit(db, req, { action, entityType, entityId, before, after, reason }) {
  const config = getConfig();
  await db`
    insert into app.audit_logs (actor_id, actor_roles, action, entity_type, entity_id, before_state, after_state,
                                reason, request_id, ip_hash, user_agent)
    values (${req?.auth?.userId ?? null}, ${req?.auth?.roles ?? []}, ${action}, ${entityType}, ${entityId ? String(entityId) : null},
            ${before === undefined ? null : db.json(before)}, ${after === undefined ? null : db.json(after)},
            ${reason ?? null}, ${req?.id ?? null}, ${req ? clientIpHash(req, config) : null}, ${req ? userAgent(req) : null})`;
}

export async function listAudit(db, { entityType, entityId, actorId, limit, cursor }) {
  return db`
    select a.id, a.actor_id, p.email as actor_email, a.actor_roles, a.action, a.entity_type, a.entity_id,
           a.before_state, a.after_state, a.reason, a.request_id, a.created_at
    from app.audit_logs a
    left join app.profiles p on p.id = a.actor_id
    where (${entityType ?? null}::text is null or a.entity_type = ${entityType ?? null})
      and (${entityId ?? null}::text is null or a.entity_id = ${entityId ?? null})
      and (${actorId ?? null}::uuid is null or a.actor_id = ${actorId ?? null})
      and (${cursor?.id ?? null}::bigint is null or a.id < ${cursor?.id ?? null})
    order by a.id desc
    limit ${limit + 1}`;
}
