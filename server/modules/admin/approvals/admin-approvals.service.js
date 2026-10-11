// Four-eyes approvals. A staff member requests a sensitive change; a DIFFERENT
// staff member with the right role approves it; only then is it executed, in
// the same database transaction as the approval. Requests expire after 7 days.

import { AppError } from '../../../core/errors.js';
import { getSql, withTransaction } from '../../../db/client.js';
import { APPROVAL_RULES } from '../../../policies/permissions.js';
import { camelize } from '../../../utils/camelize.js';
import { pageOf } from '../../../utils/schemas.js';
import { audit } from '../../audit/audit.service.js';
import { applySetting, validateSettingValue } from '../../settings/settings.service.js';

export async function createApproval(db, req, { actionType, payload, reason }) {
  const [row] = await db`
    insert into app.admin_approvals (action_type, payload, reason, requested_by)
    values (${actionType}, ${db.json(payload)}, ${reason}, ${req.auth.userId})
    returning *`;
  await audit(db, req, { action: 'approval.requested', entityType: 'admin_approval', entityId: row.id, after: { actionType, payload }, reason });
  await db`select app.emit_event('admin:ops', 'approval.created', ${db.json({ id: row.id, actionType })})`;
  return camelize(row);
}

export async function listApprovals({ status, limit, cursor }) {
  const rows = await getSql()`
    select a.*, rq.email as requested_by_email, dc.email as decided_by_email
    from app.admin_approvals a
    join app.profiles rq on rq.id = a.requested_by
    left join app.profiles dc on dc.id = a.decided_by
    where (${status ?? null}::text is null or a.status = ${status ?? null})
      and (${cursor?.t ?? null}::timestamptz is null or (a.created_at, a.id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by a.created_at desc, a.id desc
    limit ${limit + 1}`;
  const page = pageOf(rows, limit);
  return { items: page.items.map(camelize), nextCursor: page.nextCursor };
}

const EXECUTORS = {
  async 'settings.update'(tx, approval) {
    const { key, value } = approval.payload;
    validateSettingValue(key, value);
    return applySetting(tx, { key, value, actorId: approval.decided_by, approvalId: approval.id, reason: approval.reason });
  },

  async 'fee_rule.create'(tx, approval) {
    const p = approval.payload;
    const effectiveFrom = p.effectiveFrom ? new Date(p.effectiveFrom) : new Date();
    await tx`
      update app.fee_rules set effective_to = ${effectiveFrom}
      where fee_type = ${p.feeType} and effective_to is null and effective_from < ${effectiveFrom}
        and asset_code is not distinct from ${p.asset ?? null} and network_code is not distinct from ${p.network ?? null}`;
    const [rule] = await tx`
      insert into app.fee_rules (fee_type, asset_code, network_code, rate, min_fee, effective_from, change_reason, created_by)
      values (${p.feeType}, ${p.asset ?? null}, ${p.network ?? null}, ${p.rate}, ${p.minFee ?? '0'}, ${effectiveFrom},
              ${approval.reason}, ${approval.requested_by})
      returning id`;
    return { feeRuleId: rule.id };
  },

  async 'ledger.adjustment'(tx, approval) {
    const p = approval.payload;
    const [row] = await tx`
      select app.post_adjustment(${approval.id}, ${p.userId}, ${p.asset}, ${p.direction}, ${p.amount}, ${approval.reason},
                                 ${approval.decided_by}) as transaction_id`;
    return { transactionId: row.transaction_id };
  },

  async 'role.grant'(tx, approval) {
    const { userId, role } = approval.payload;
    await tx`insert into app.user_roles (user_id, role, granted_by) values (${userId}, ${role}, ${approval.decided_by}) on conflict do nothing`;
    return { userId, role };
  },

  async 'role.revoke'(tx, approval) {
    const { userId, role } = approval.payload;
    const [{ count }] = await tx`select count(*)::int from app.user_roles where role = 'super_admin' and user_id <> ${userId}`;
    if (role === 'super_admin' && count === 0) throw new AppError('last_super_admin', { status: 409 });
    await tx`delete from app.user_roles where user_id = ${userId} and role = ${role}`;
    return { userId, role };
  },

  async 'user.reinstate'(tx, approval) {
    const { userId } = approval.payload;
    await tx`update app.profiles set status = 'active', status_reason = null where id = ${userId}`;
    await tx`select app.notify(${userId}, 'security_alert', ${tx.json({ kind: 'account_reinstated' })}, '/profile')`;
    return { userId, status: 'active' };
  },
};

export async function approve(req, id, note) {
  return withTransaction(async (tx) => {
    const [approval] = await tx`select * from app.admin_approvals where id = ${id} for update`;
    if (!approval) throw new AppError('not_found');
    if (approval.status !== 'pending') throw new AppError('invalid_status_transition');
    if (new Date(approval.expires_at) <= new Date()) throw new AppError('approval_expired', { status: 409 });
    if (approval.requested_by === req.auth.userId) throw new AppError('cannot_approve_own_request', { status: 403 });
    const allowed = APPROVAL_RULES[approval.action_type] || [];
    if (!req.auth.roles.some((r) => allowed.includes(r))) throw new AppError('forbidden');

    const [decided] = await tx`
      update app.admin_approvals set status = 'approved', decided_by = ${req.auth.userId}, decided_at = now(), decision_note = ${note ?? null}
      where id = ${id} returning *`;
    const result = await EXECUTORS[approval.action_type](tx, decided);
    const [executed] = await tx`
      update app.admin_approvals set status = 'executed', executed_at = now(), result = ${tx.json(result ?? {})}
      where id = ${id} returning *`;
    await audit(tx, req, {
      action: 'approval.executed',
      entityType: 'admin_approval',
      entityId: id,
      before: { status: 'pending' },
      after: { status: 'executed', actionType: approval.action_type, payload: approval.payload, result },
      reason: note,
    });
    return camelize(executed);
  });
}

export async function reject(req, id, note) {
  return withTransaction(async (tx) => {
    const [approval] = await tx`select * from app.admin_approvals where id = ${id} for update`;
    if (!approval) throw new AppError('not_found');
    if (approval.status !== 'pending') throw new AppError('invalid_status_transition');
    if (approval.requested_by === req.auth.userId) {
      // Requesters may withdraw their own request.
    } else if (!req.auth.roles.some((r) => (APPROVAL_RULES[approval.action_type] || []).includes(r))) {
      throw new AppError('forbidden');
    }
    const [row] = await tx`
      update app.admin_approvals set status = 'rejected', decided_by = ${approval.requested_by === req.auth.userId ? null : req.auth.userId},
             decided_at = now(), decision_note = ${note}
      where id = ${id} returning *`;
    await audit(tx, req, { action: 'approval.rejected', entityType: 'admin_approval', entityId: id, reason: note });
    return camelize(row);
  });
}
