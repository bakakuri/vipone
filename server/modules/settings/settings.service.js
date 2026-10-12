// Runtime settings (app.system_settings). Reads are cheap single queries;
// changes go through the approval workflow (modules/admin/approvals).

import { AppError } from '../../core/errors.js';
import { dec } from '../../core/money.js';

export async function getAllSettings(db) {
  return db`select key, value, description, approval_policy, updated_by, updated_at from app.system_settings order by key`;
}

export async function getSetting(db, key, fallback = null) {
  const [row] = await db`select value from app.system_settings where key = ${key}`;
  return row ? row.value : fallback;
}

export async function getSettings(db, keys) {
  const rows = await db`select key, value from app.system_settings where key in ${db(keys)}`;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// Decides whether a change makes the platform less strict ("relaxing").
// Used for settings with approval_policy = 'when_relaxing': tightening is
// immediate (e.g. pausing withdrawals), relaxing needs a second approver.
export function isRelaxingChange(key, oldValue, newValue) {
  if (typeof oldValue === 'boolean' && typeof newValue === 'boolean') {
    // For "*.enabled" and "require*" flags, turning ON enabling flags relaxes
    // money movement; turning OFF requirement flags relaxes controls.
    if (/require/.test(key)) return oldValue === true && newValue === false;
    return oldValue === false && newValue === true;
  }
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    // Lists of restrictions (paused assets, blocked countries, KYC-gated actions):
    // removing an entry relaxes.
    return oldValue.some((v) => !newValue.includes(v));
  }
  return true;
}

export function requiresApproval(setting, newValue) {
  if (setting.approval_policy === 'none') return false;
  if (setting.approval_policy === 'always') return true;
  return isRelaxingChange(setting.key, setting.value, newValue);
}

// Shape checks so a setting can never be stored with an unusable value.
const VALIDATORS = {
  boolean: (v) => typeof v === 'boolean',
  nonNegativeInt: (v) => Number.isInteger(v) && v >= 0 && v <= 3650,
  rate: (v) => typeof v === 'string' && /^0(\.\d{1,8})?$/.test(v) && dec(v).lt(1),
  assetMap: (v) =>
    v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([k, x]) => /^[A-Z0-9]{2,10}$/.test(k) && /^\d+(\.\d+)?$/.test(String(x))),
  stringList: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length <= 40),
  email: (v) => v === null || (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),
  scope: (v) => v === 'all_deposits' || v === 'first_deposit',
  // {"en": "...", "ru": "...", "ar": "...", "ka": "..."}; empty object hides the text.
  localizedText: (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
    && Object.entries(v).every(([k, x]) => ['en', 'ru', 'ar', 'ka'].includes(k) && typeof x === 'string' && x.length <= 2000),
};

export const SETTING_TYPES = {
  'deposits.enabled': 'boolean',
  'withdrawals.enabled': 'boolean',
  'withdrawals.paused_assets': 'stringList',
  'funds.deposit_hold_days': 'nonNegativeInt',
  'withdrawal.new_address_cooldown_hours': 'nonNegativeInt',
  'withdrawal.dual_approval_threshold': 'assetMap',
  'withdrawal.daily_limit': 'assetMap',
  'withdrawal.quote_ttl_seconds': 'nonNegativeInt',
  'withdrawal.require_mfa': 'boolean',
  'deposits.request_ttl_hours': 'nonNegativeInt',
  'referral.enabled': 'boolean',
  'referral.deposit_rate': 'rate',
  'referral.deposit_scope': 'scope',
  'referral.profit_rate': 'rate',
  'referral.hold_days': 'nonNegativeInt',
  'referral.require_full_coverage': 'boolean',
  'compliance.kyc_required_for': 'stringList',
  'compliance.blocked_countries': 'stringList',
  'reconciliation.tolerance': 'assetMap',
  'live.enabled': 'boolean',
  'languages.enabled': 'stringList',
  'public_stats.enabled': 'boolean',
  'support.contact_email': 'email',
  'withdrawal.address_email_confirmation': 'boolean',
  'deposits.page_notice': 'localizedText',
  'deposits.automatic': 'boolean',
  'security.require_second_approver': 'boolean',
};

export function validateSettingValue(key, value) {
  const type = SETTING_TYPES[key];
  if (!type) throw new AppError('not_found', { details: { resource: 'setting' } });
  if (!VALIDATORS[type](value)) throw new AppError('validation_failed', { details: [{ path: 'value', code: `expected_${type}` }] });
  if (key === 'languages.enabled' && (!value.includes('en') || value.some((l) => !['en', 'ru', 'ar', 'ka'].includes(l)))) {
    throw new AppError('validation_failed', { details: [{ path: 'value', code: 'invalid_languages' }] });
  }
  if (key === 'withdrawal.quote_ttl_seconds' && (value < 30 || value > 3600)) {
    throw new AppError('validation_failed', { details: [{ path: 'value', code: 'out_of_range' }] });
  }
}

export async function applySetting(db, { key, value, actorId, approvalId, reason }) {
  await db`select set_config('app.change_reason', ${reason ?? ''}, true), set_config('app.approval_id', ${approvalId ?? ''}, true)`;
  const [row] = await db`
    update app.system_settings set value = ${db.json(value)}, updated_by = ${actorId}, updated_at = now()
    where key = ${key}
    returning key, value, updated_at`;
  if (!row) throw new AppError('not_found', { details: { resource: 'setting' } });
  return row;
}
