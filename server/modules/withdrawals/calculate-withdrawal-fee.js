// Single source of the withdrawal fee calculation (server only; the browser
// displays the quote the server returns).
//
//   platform fee = max(amount x rate, minimum), rounded half-up to the asset precision
//   network fee  = the current estimate for the network (asset_networks)
//   net amount   = amount - platform fee - network fee   (must stay positive)

import { AppError } from '../../core/errors.js';
import { dec, max, roundHalfUp, toAmountString } from '../../core/money.js';

export function calculateWithdrawalFee({ amount, rate, minFee = '0', networkFee, decimals }) {
  const gross = dec(amount);
  if (gross.decimalPlaces() > decimals) throw new AppError('amount_precision', { status: 422 });
  if (gross.lte(0)) throw new AppError('amount_positive', { status: 422 });
  const platformFee = roundHalfUp(max(gross.mul(rate), dec(minFee)), decimals);
  const network = dec(networkFee);
  const net = gross.minus(platformFee).minus(network);
  if (net.lte(0)) throw new AppError('amount_below_fees', { status: 422, details: { value: toAmountString(platformFee.plus(network)) } });
  return {
    amount: toAmountString(gross),
    platformFee: toAmountString(platformFee),
    networkFee: toAmountString(network),
    netAmount: toAmountString(net),
    feeRate: toAmountString(dec(rate)),
  };
}
