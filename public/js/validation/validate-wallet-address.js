// Address format check shared by browser and server. Network rules (pattern,
// memo) come from the API (`/api/v1/public/assets`), i.e. from the database,
// so there is one source of truth. The server additionally verifies checksums.

export function normalizeAddress(value) {
  return String(value ?? '').trim();
}

/**
 * @param {string} address
 * @param {{addressPattern: string, memoRequired?: boolean, memoPattern?: string|null}} network
 * @param {string} [memo]
 * @returns {null|'required'|'address_invalid'|'memo_required'|'memo_invalid'}
 */
export function validateWalletAddress(address, network, memo = '') {
  const value = normalizeAddress(address);
  if (!value) return 'required';
  if (!network?.addressPattern) return 'address_invalid';
  let pattern;
  try {
    pattern = new RegExp(network.addressPattern);
  } catch {
    return 'address_invalid';
  }
  if (!pattern.test(value)) return 'address_invalid';
  const memoValue = String(memo ?? '').trim();
  if (network.memoRequired && !memoValue) return 'memo_required';
  if (memoValue && network.memoPattern && !new RegExp(network.memoPattern).test(memoValue)) return 'memo_invalid';
  return null;
}
