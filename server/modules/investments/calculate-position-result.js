// Allocation of a realised strategy result to positions.
//
// For each position open during the period:
//   share   = overlap(position life, period) / period length
//   gross   = value before the result x gross rate x share   (truncated toward zero)
//   fee     = gross x performance fee rate, only on gains    (rounded half-up)
//   net     = gross - fee                                     (losses carry no fee)
// The SQL function app.post_investment_result re-checks the arithmetic
// relationships before posting.

import { dec, roundHalfUp, toAmountString, truncate } from '../../core/money.js';

function overlapMs(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function calculatePositionResult({ valueBefore, startedAt, maturityAt, periodStart, periodEnd, grossRate, performanceFeeRate, decimals }) {
  const ps = new Date(periodStart).getTime();
  const pe = new Date(periodEnd).getTime();
  const share = dec(overlapMs(new Date(startedAt).getTime(), new Date(maturityAt).getTime(), ps, pe)).div(pe - ps);
  const gross = truncate(dec(valueBefore).mul(grossRate).mul(share), decimals);
  const fee = gross.gt(0) ? roundHalfUp(gross.mul(performanceFeeRate), decimals) : dec(0);
  const net = gross.minus(fee);
  return {
    share: toAmountString(share.toDecimalPlaces(8)),
    gross: toAmountString(gross),
    fee: toAmountString(fee),
    net: toAmountString(net),
  };
}

export function allocateResult({ positions, periodStart, periodEnd, grossRate, performanceFeeRate, decimals }) {
  return positions.map((p) => ({
    positionId: p.position_id ?? p.positionId,
    userId: p.user_id ?? p.userId,
    ...calculatePositionResult({
      valueBefore: p.value_before ?? p.valueBefore,
      startedAt: p.started_at ?? p.startedAt,
      maturityAt: p.maturity_at ?? p.maturityAt,
      periodStart,
      periodEnd,
      grossRate,
      performanceFeeRate,
      decimals,
    }),
  }));
}
