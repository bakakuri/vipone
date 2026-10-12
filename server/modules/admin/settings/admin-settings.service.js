// Runtime settings and fee rules. Tightening a control applies at once;
// relaxing it (or any 'always' setting) becomes a four-eyes approval request.

import { AppError } from '../../../core/errors.js';
import { getSql, withTransaction } from '../../../db/client.js';
import { camelize, trimAmount } from '../../../utils/camelize.js';
import { audit } from '../../audit/audit.service.js';
import { SETTING_TYPES, applySetting, getAllSettings, requiresApproval, validateSettingValue } from '../../settings/settings.service.js';
import { createApproval } from '../approvals/admin-approvals.service.js';

export async function listSettings() {
  const sql = getSql();
  const settings = await getAllSettings(sql);
  const pending = await sql`
    select id, payload ->> 'key' as key, payload -> 'value' as value, requested_by, created_at
    from app.admin_approvals where status = 'pending' and action_type = 'settings.update'`;
  return settings.map((s) => ({ ...camelize(s), type: SETTING_TYPES[s.key] ?? 'json', pendingChange: camelize(pending.find((p) => p.key === s.key)) ?? null }));
}

export async function settingHistory(key) {
  const rows = await getSql()`
    select h.old_value, h.new_value, h.reason, h.approval_id, h.changed_at, p.email as changed_by_email
    from app.system_settings_history h left join app.profiles p on p.id = h.changed_by
    where h.key = ${key} order by h.changed_at desc limit 50`;
  return rows.map(camelize);
}

export async function changeSetting(req, key, value, reason) {
  validateSettingValue(key, value);
  return withTransaction(async (tx) => {
    const [setting] = await tx`select * from app.system_settings where key = ${key} for update`;
    if (!setting) throw new AppError('not_found');
    if (JSON.stringify(setting.value) === JSON.stringify(value)) throw new AppError('no_change', { status: 409 });
    if (requiresApproval(setting, value)) {
      const approval = await createApproval(tx, req, { actionType: 'settings.update', payload: { key, value }, reason });
      return { applied: approval.status === 'executed', approval };
    }
    const row = await applySetting(tx, { key, value, actorId: req.auth.userId, reason });
    await audit(tx, req, { action: 'settings.updated', entityType: 'system_setting', entityId: key, before: setting.value, after: value, reason });
    return { applied: true, setting: camelize(row) };
  });
}

export async function listFeeRules() {
  const rows = await getSql()`
    select r.*, p.email as created_by_email from app.fee_rules r left join app.profiles p on p.id = r.created_by
    order by r.effective_from desc limit 100`;
  return rows.map((r) => ({ ...camelize(r), rate: trimAmount(r.rate), minFee: trimAmount(r.min_fee) }));
}

export async function requestFeeRule(req, input) {
  return withTransaction((tx) =>
    createApproval(tx, req, {
      actionType: 'fee_rule.create',
      payload: { feeType: 'withdrawal_platform', asset: input.asset ?? null, network: input.network ?? null, rate: input.rate, minFee: input.minFee ?? '0', effectiveFrom: input.effectiveFrom ?? null },
      reason: input.reason,
    }),
  );
}

export async function requestAdjustment(req, input) {
  return withTransaction(async (tx) => {
    const [user] = await tx`select id from app.profiles where id = ${input.userId}`;
    if (!user) throw new AppError('not_found');
    return createApproval(tx, req, {
      actionType: 'ledger.adjustment',
      payload: { userId: input.userId, asset: input.asset, direction: input.direction, amount: input.amount },
      reason: input.reason,
    });
  });
}
