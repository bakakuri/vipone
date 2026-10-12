// Converts PostgreSQL errors into AppErrors. Domain errors raised with
// app.raise_error() use SQLSTATE P0001 and a stable code as the message.

import { AppError } from './errors.js';

const DOMAIN_STATUS = {
  not_found: 404,
  insufficient_funds: 409,
  insufficient_withdrawable_balance: 409,
  insufficient_system_funds: 409,
  daily_limit_exceeded: 409,
  invalid_status_transition: 409,
  invalid_initial_status: 409,
  immutable_record: 409,
  idempotency_conflict: 409,
  withdrawals_paused: 503,
  deposits_paused: 503,
  deposit_address_unavailable: 503,
  account_restricted: 403,
  cannot_approve_own_request: 403,
  second_approver_required: 403,
  independent_verifier_required: 403,
  approval_required: 403,
  terms_changed: 409,
  quote_expired: 409,
  quote_already_used: 409,
  wallet_cooldown: 409,
  wallet_in_use: 409,
  wallet_already_exists: 409,
  product_capacity_reached: 409,
  tx_hash_in_use: 409,
  tx_hash_already_recorded: 409,
  withdrawal_not_cancellable: 409,
  wallet_not_active: 409,
  wallet_not_pending: 409,
  position_not_active: 409,
  early_exit_not_allowed: 409,
  product_not_available: 409,
  result_not_approved: 409,
  result_period_overlap: 409,
  deposit_not_confirmed: 409,
  deposit_flagged: 409,
  nothing_to_return: 409,
  too_many_open_deposit_requests: 409,
  too_many_wallets: 409,
  network_not_available: 422,
  deposit_method_unavailable: 409,
  too_many_pending: 409,
  duplicate_transaction: 409,
  tx_hash_required: 422,
  feature_unavailable: 503,
};

// Detail strings that are safe to show (amounts, statuses, network codes).
const EXPOSE_DETAIL = new Set([
  'insufficient_withdrawable_balance', 'daily_limit_exceeded', 'amount_below_minimum', 'amount_above_maximum',
  'wallet_cooldown', 'product_capacity_reached', 'terms_changed', 'account_restricted', 'withdrawal_not_cancellable',
  'insufficient_funds', 'invalid_address_format', 'memo_required', 'asset_network_not_supported', 'withdrawals_paused',
  'feature_unavailable',
]);

export function mapDbError(err) {
  if (!err || typeof err !== 'object' || !('code' in err)) return err;
  if (err instanceof AppError) return err;

  if (err.code === 'P0001') {
    const code = String(err.message || 'conflict').trim();
    const details = EXPOSE_DETAIL.has(code) && err.detail ? { value: err.detail } : undefined;
    return new AppError(code, { status: DOMAIN_STATUS[code] ?? 422, details, cause: err });
  }
  if (err.code === '23505') return new AppError('conflict', { status: 409, cause: err });
  if (err.code === '23514' || err.code === '23502' || err.code === '22P02' || err.code === '22003') {
    return new AppError('validation_failed', { status: 422, details: { constraint: err.constraint_name }, cause: err });
  }
  if (err.code === '23503') return new AppError('not_found', { status: 404, cause: err });
  if (err.code === '40001' || err.code === '40P01') return new AppError('conflict', { status: 409, details: { retry: true }, cause: err });
  if (err.code === '57014') return new AppError('service_unavailable', { status: 503, cause: err });
  return err;
}
