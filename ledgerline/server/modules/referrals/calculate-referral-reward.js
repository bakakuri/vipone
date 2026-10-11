// Referral reward amount: base x rate, truncated to the asset precision
// (never rounded up). Returns null when the reward would be zero.

import { dec, toAmountString, truncate } from '../../core/money.js';

export function calculateReferralReward({ baseAmount, rate, decimals }) {
  const base = dec(baseAmount);
  const r = dec(rate);
  if (base.lte(0) || r.lte(0) || r.gte(1)) return null;
  const reward = truncate(base.mul(r), decimals);
  return reward.gt(0) ? toAmountString(reward) : null;
}
