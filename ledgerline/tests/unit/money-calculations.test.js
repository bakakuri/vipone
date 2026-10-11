// Fee, reward, result and period arithmetic — all exact decimal strings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasAtMostDecimals, roundHalfUp, toAmountString, truncate } from '../../server/core/money.js';
import { calculateInvestmentPeriod } from '../../server/modules/investments/calculate-investment-period.js';
import { allocateResult, calculatePositionResult } from '../../server/modules/investments/calculate-position-result.js';
import { calculateReferralReward } from '../../server/modules/referrals/calculate-referral-reward.js';
import { calculateWithdrawalFee } from '../../server/modules/withdrawals/calculate-withdrawal-fee.js';
import { calculateScenario } from '../../public/js/calculations/investment-scenario.js';

test('withdrawal fee: 3% platform fee plus the network fee', () => {
  const q = calculateWithdrawalFee({ amount: '100', rate: '0.03', networkFee: '1.5', decimals: 6 });
  assert.deepEqual(q, { amount: '100', platformFee: '3', networkFee: '1.5', netAmount: '95.5', feeRate: '0.03' });
});

test('withdrawal fee: rounding half-up at the asset precision, no float drift', () => {
  const q = calculateWithdrawalFee({ amount: '0.1', rate: '0.03', networkFee: '0.00015', decimals: 8 });
  assert.equal(q.platformFee, '0.003');
  assert.equal(q.netAmount, '0.09685');
  const r = calculateWithdrawalFee({ amount: '33.333333', rate: '0.03', networkFee: '0', decimals: 6 });
  assert.equal(r.platformFee, '1');
  assert.equal(r.netAmount, '32.333333');
});

test('withdrawal fee: minimum fee applies; fees larger than the amount are refused', () => {
  assert.equal(calculateWithdrawalFee({ amount: '10', rate: '0.03', minFee: '2', networkFee: '1', decimals: 6 }).platformFee, '2');
  assert.throws(() => calculateWithdrawalFee({ amount: '2', rate: '0.03', networkFee: '2', decimals: 6 }), { code: 'amount_below_fees' });
  assert.throws(() => calculateWithdrawalFee({ amount: '0', rate: '0.03', networkFee: '1', decimals: 6 }), { code: 'amount_positive' });
  assert.throws(() => calculateWithdrawalFee({ amount: '1.0000001', rate: '0.03', networkFee: '0', decimals: 6 }), { code: 'amount_precision' });
});

test('referral reward: 5% of a deposit, 2% of profit, truncated, never zero', () => {
  assert.equal(calculateReferralReward({ baseAmount: '1000', rate: '0.05', decimals: 6 }), '50');
  assert.equal(calculateReferralReward({ baseAmount: '123.456789', rate: '0.02', decimals: 6 }), '2.469135');
  assert.equal(calculateReferralReward({ baseAmount: '0.00001', rate: '0.02', decimals: 6 }), null);
  assert.equal(calculateReferralReward({ baseAmount: '-5', rate: '0.05', decimals: 6 }), null);
  assert.equal(calculateReferralReward({ baseAmount: '5', rate: '1', decimals: 6 }), null);
});

test('position result: share of the period, fee only on gains, losses without fee', () => {
  const day = 86400000;
  const periodStart = new Date('2026-01-01T00:00:00Z');
  const periodEnd = new Date(periodStart.getTime() + 10 * day);
  const full = calculatePositionResult({
    valueBefore: '1000', startedAt: new Date(periodStart.getTime() - day), maturityAt: new Date(periodEnd.getTime() + day),
    periodStart, periodEnd, grossRate: '0.02', performanceFeeRate: '0.2', decimals: 6,
  });
  assert.deepEqual(full, { share: '1', gross: '20', fee: '4', net: '16' });
  const half = calculatePositionResult({
    valueBefore: '1000', startedAt: new Date(periodStart.getTime() + 5 * day), maturityAt: new Date(periodEnd.getTime() + day),
    periodStart, periodEnd, grossRate: '0.02', performanceFeeRate: '0.2', decimals: 6,
  });
  assert.deepEqual(half, { share: '0.5', gross: '10', fee: '2', net: '8' });
  const loss = calculatePositionResult({
    valueBefore: '1000', startedAt: periodStart, maturityAt: periodEnd, periodStart, periodEnd, grossRate: '-0.015', performanceFeeRate: '0.2', decimals: 6,
  });
  assert.deepEqual(loss, { share: '1', gross: '-15', fee: '0', net: '-15' });
  const rows = allocateResult({ positions: [{ position_id: 'a', user_id: 'u', value_before: '1000', started_at: periodStart, maturity_at: periodEnd }], periodStart, periodEnd, grossRate: '0.01', performanceFeeRate: '0', decimals: 6 });
  assert.equal(rows[0].net, '10');
});

test('investment period: 28 days, progress from timestamps only', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-29T00:00:00Z');
  const p = calculateInvestmentPeriod({ startedAt: start, maturityAt: end, now: new Date('2026-01-15T00:00:00Z') });
  assert.equal(p.termDays, 28);
  assert.equal(p.elapsedDays, 14);
  assert.equal(p.progress, 0.5);
  assert.equal(p.matured, false);
  const after = calculateInvestmentPeriod({ startedAt: start, maturityAt: end, now: new Date('2026-02-10T00:00:00Z') });
  assert.equal(after.progress, 1);
  assert.equal(after.remainingMs, 0);
  assert.equal(after.matured, true);
});

test('money helpers keep exact digits', () => {
  assert.equal(toAmountString(truncate('1.23456789', 6)), '1.234567');
  assert.equal(toAmountString(roundHalfUp('1.2345675', 6)), '1.234568');
  assert.equal(hasAtMostDecimals('1.000001', 6), true);
  assert.equal(hasAtMostDecimals('1.0000001', 6), false);
});

test('browser calculator uses the same rules and never assumes a rate', () => {
  const s = calculateScenario({ amount: '1000', ratePercent: '2', termDays: 28, performanceFeeRate: '0.2', earlyExitFeeRate: '0.02', decimals: 6, start: new Date('2026-01-01T00:00:00Z') });
  assert.equal(s.gross, '20');
  assert.equal(s.fee, '4');
  assert.equal(s.valueAtMaturity, '1016');
  assert.equal(s.earlyExitReceive, '980');
  assert.equal(s.maturity.toISOString(), '2026-01-29T00:00:00.000Z');
  const loss = calculateScenario({ amount: '1000', ratePercent: '-3', termDays: 28, performanceFeeRate: '0.2', decimals: 6 });
  assert.equal(loss.fee, '0');
  assert.equal(loss.valueAtMaturity, '970');
  const zero = calculateScenario({ amount: '1000', ratePercent: '0', termDays: 28, performanceFeeRate: '0.2', decimals: 6 });
  assert.equal(zero.valueAtMaturity, '1000');
});
