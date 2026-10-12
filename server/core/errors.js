// Application errors carry a stable, machine-readable code. The client
// translates the code (locales/*/errors.json); the server never sends stack
// traces, SQL or secrets to the browser.

const STATUS_BY_CODE = {
  validation_failed: 422,
  invalid_json: 400,
  payload_too_large: 413,
  not_found: 404,
  route_not_found: 404,
  method_not_allowed: 405,
  unauthenticated: 401,
  token_expired: 401,
  session_expired: 401,
  invalid_credentials: 401,
  email_not_confirmed: 403,
  mfa_required: 403,
  mfa_invalid_code: 422,
  forbidden: 403,
  csrf_failed: 403,
  origin_not_allowed: 403,
  account_restricted: 403,
  kyc_required: 403,
  country_not_supported: 403,
  rate_limited: 429,
  conflict: 409,
  request_in_progress: 409,
  idempotency_key_required: 428,
  idempotency_key_reuse: 422,
  idempotency_conflict: 409,
  invalid_status_transition: 409,
  insufficient_funds: 409,
  insufficient_withdrawable_balance: 409,
  insufficient_system_funds: 409,
  service_unavailable: 503,
  feature_unavailable: 503,
  internal_error: 500,
  link_expired: 422,
  user_exists: 409,
  password_weak: 422,
  password_same: 422,
  auth_failed: 400,
  reauthentication_required: 401,
  mfa_setup_required: 403,
  mfa_already_enabled: 409,
  mfa_not_enabled: 409,
  mfa_unavailable: 503,
  mfa_setup_failed: 422,
  code_invalid: 422,
  code_expired: 422,
  too_many_attempts: 429,
  referral_code_invalid: 422,
  amount_precision: 422,
  amount_positive: 422,
  amount_invalid: 422,
  amount_below_minimum: 422,
  amount_below_fees: 422,
  wallet_not_active: 409,
  asset_network_not_supported: 422,
  no_change: 409,
};

export class AppError extends Error {
  constructor(code, { status, details, message, cause } = {}) {
    super(message || code, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = status ?? STATUS_BY_CODE[code] ?? 400;
    this.details = details;
  }
}

export const notFound = (what) => new AppError('not_found', { details: what ? { resource: what } : undefined });
export const forbidden = (reason) => new AppError('forbidden', { details: reason ? { reason } : undefined });

export function isAppError(err) {
  return err instanceof AppError;
}
