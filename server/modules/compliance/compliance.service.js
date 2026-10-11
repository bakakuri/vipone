// Compliance gates that apply before money moves.
// In live mode, identity verification (KYC) is required for the actions listed
// in setting compliance.kyc_required_for. Demo mode does not enforce KYC so
// the product can be evaluated without real identities.

import { getConfig } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { getSetting } from '../settings/settings.service.js';

export async function assertKycFor(db, auth, action) {
  if (!getConfig().isLive) return;
  const required = await getSetting(db, 'compliance.kyc_required_for', []);
  if (Array.isArray(required) && required.includes(action) && auth.profile.kyc_status !== 'approved') {
    throw new AppError('kyc_required', { details: { action } });
  }
}

export function assertAccountActive(auth) {
  if (auth.profile.status !== 'active') throw new AppError('account_restricted', { details: { value: auth.profile.status } });
}
