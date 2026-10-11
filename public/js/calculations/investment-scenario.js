// "What if" arithmetic behind the investment calculator, using the same
// rounding rules as the server (results truncated, performance fee rounded
// half-up, early-exit fee truncated). Inputs are decimal strings; no floating
// point. It never invents a rate: the caller passes the one the user typed.
import Decimal from '../../vendor/decimal.mjs';

export function calculateScenario({ amount, ratePercent, termDays, performanceFeeRate, earlyExitFeeRate = '0', decimals, start = new Date() }) {
  const principal = new Decimal(amount);
  const rate = new Decimal(ratePercent).div(100);
  const gross = principal.mul(rate).toDecimalPlaces(decimals, Decimal.ROUND_DOWN);
  const fee = gross.gt(0) ? gross.mul(performanceFeeRate).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP) : new Decimal(0);
  const net = gross.minus(fee);
  const exitFee = principal.mul(earlyExitFeeRate || 0).toDecimalPlaces(decimals, Decimal.ROUND_DOWN);
  return {
    gross: gross.toFixed(),
    fee: fee.toFixed(),
    net: net.toFixed(),
    valueAtMaturity: principal.plus(net).toFixed(),
    earlyExitFee: exitFee.toFixed(),
    earlyExitReceive: principal.minus(exitFee).toFixed(),
    maturity: new Date(start.getTime() + termDays * 86400000),
  };
}
