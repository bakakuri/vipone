// External withdrawal addresses. The platform stores only public addresses —
// never private keys or seed phrases — and adding an address gives the
// platform no control over it. New addresses need an emailed confirmation
// code (unless switched off in settings) and then wait out a cooldown before
// they can receive funds.

import { getConfig } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { getSql, withTransaction } from '../../db/client.js';
import { randomNumericCode, sha256Hex, timingSafeEqualString } from '../../security/crypto.js';
import { verifyAddressChecksum } from '../../utils/address-checksum.js';
import { camelize } from '../../utils/camelize.js';
import { validateWalletAddress } from '../../../public/js/validation/validate-wallet-address.js';
import { getAssetNetwork } from '../assets/assets.repository.js';
import { assertAccountActive } from '../compliance/compliance.service.js';
import { dispatchSoon, queueEmail } from '../notifications/email-outbox.js';
import { recordSecurityEvent } from '../profile/profile.repository.js';
import { getSetting } from '../settings/settings.service.js';

const CODE_TTL_MINUTES = 15;

function toApi(row) {
  const w = camelize(row);
  delete w.userId;
  return w;
}

export async function listWallets(userId) {
  const rows = await getSql()`
    select id, label, asset_code, network_code, address, memo, status, is_default, confirmed_at, usable_from, created_at
    from app.withdrawal_wallets where user_id = ${userId} and status <> 'removed'
    order by is_default desc, created_at desc`;
  return rows.map(toApi);
}

export async function walletHistory(userId) {
  const rows = await getSql()`
    select h.wallet_id, h.event, h.details, h.created_at, w.label, w.network_code
    from app.wallet_address_history h join app.withdrawal_wallets w on w.id = h.wallet_id
    where h.user_id = ${userId} order by h.created_at desc limit 100`;
  return rows.map(camelize);
}

async function sendCode(tx, auth, walletId) {
  const code = randomNumericCode(6);
  await tx`
    update app.verification_codes set consumed_at = now()
    where user_id = ${auth.userId} and purpose = 'wallet_confirmation' and reference_id = ${walletId} and consumed_at is null`;
  await tx`
    insert into app.verification_codes (user_id, purpose, reference_id, code_hash, expires_at)
    values (${auth.userId}, 'wallet_confirmation', ${walletId}, ${sha256Hex(`${walletId}:${code}`)},
            now() + ${`${CODE_TTL_MINUTES} minutes`}::interval)`;
  return code;
}

export async function addWallet(auth, { label, asset, network, address, memo }, ctx) {
  assertAccountActive(auth);
  const sql = getSql();
  const an = await getAssetNetwork(sql, asset, network);
  if (!an || !an.withdrawalEnabled) throw new AppError('asset_network_not_supported', { status: 422 });
  const formatError = validateWalletAddress(address, { addressPattern: an.addressPattern, memoRequired: an.memoRequired, memoPattern: an.memoPattern }, memo);
  if (formatError) throw new AppError('validation_failed', { details: [{ path: formatError.startsWith('memo') ? 'body.memo' : 'body.address', code: formatError }] });
  if (!verifyAddressChecksum(an.family, address.trim())) {
    throw new AppError('validation_failed', { details: [{ path: 'body.address', code: 'address_checksum' }] });
  }

  const { wallet, code } = await withTransaction(async (tx) => {
    const [row] = await tx`
      select * from app.add_withdrawal_wallet(${auth.userId}, ${label}, ${asset}, ${network}, ${address.trim()},
                                              ${memo?.trim() || null}, ${ctx.ipHash})`;
    // A referred user withdrawing to the referrer's address is a risk signal.
    await tx`
      insert into app.risk_flags (user_id, flag_type, severity, details)
      select ${auth.userId}, 'shared_wallet_with_referrer', 'medium', jsonb_build_object('walletId', ${row.id}::uuid)
      from app.referral_relationships r
      join app.withdrawal_wallets w on w.user_id = r.referrer_user_id and w.network_code = ${network} and w.address = ${address.trim()} and w.status <> 'removed'
      where r.referred_user_id = ${auth.userId}
      limit 1`;
    await recordSecurityEvent(tx, { userId: auth.userId, type: 'wallet_added', ipHash: ctx.ipHash, userAgent: ctx.userAgent, metadata: { walletId: row.id, network } });
    await tx`select app.notify(${auth.userId}, 'wallet_added', ${tx.json({ label, network })}, '/wallets')`;
    // Email codes can be switched off (Admin → Settings) when the platform has
    // no working email: the address is then confirmed at once and still waits
    // out the new-address cooldown before it can be used.
    if ((await getSetting(tx, 'withdrawal.address_email_confirmation', true)) === false) {
      const [active] = await tx`select * from app.confirm_withdrawal_wallet(${auth.userId}, ${row.id}, ${ctx.ipHash})`;
      await recordSecurityEvent(tx, { userId: auth.userId, type: 'wallet_confirmed', ipHash: ctx.ipHash, userAgent: ctx.userAgent, metadata: { walletId: row.id, emailCode: false } });
      return { wallet: active, code: null };
    }
    const c = await sendCode(tx, auth, row.id);
    await queueEmail(tx, {
      to: auth.email,
      template: 'wallet_confirmation',
      locale: auth.profile.locale,
      params: { code: c, label, network, address: row.address, minutes: CODE_TTL_MINUTES },
    });
    return { wallet: row, code: c };
  });
  await dispatchSoon();
  const result = toApi(wallet);
  // Development helper so local testing works without an inbox.
  if (code && getConfig().email.provider === 'log' && !getConfig().isProduction) result.devCode = code;
  return result;
}

// Withdrawal by address (no address book step): reuses the user's saved
// address, or saves and confirms it at once. The new-address waiting period
// still applies (setting withdrawal.new_address_cooldown_hours) and every
// withdrawal is reviewed by staff before it is paid.
export async function useWithdrawalAddress(auth, { asset, network, address, memo }, ctx) {
  assertAccountActive(auth);
  const sql = getSql();
  const clean = address.trim();
  const cleanMemo = memo?.trim() || null;
  const an = await getAssetNetwork(sql, asset, network);
  if (!an || !an.withdrawalEnabled) throw new AppError('asset_network_not_supported', { status: 422 });
  const formatError = validateWalletAddress(clean, { addressPattern: an.addressPattern, memoRequired: an.memoRequired, memoPattern: an.memoPattern }, cleanMemo);
  if (formatError) throw new AppError('validation_failed', { details: [{ path: formatError.startsWith('memo') ? 'body.memo' : 'body.address', code: formatError }] });
  if (!verifyAddressChecksum(an.family, clean)) {
    throw new AppError('validation_failed', { details: [{ path: 'body.address', code: 'address_checksum' }] });
  }
  return withTransaction(async (tx) => {
    const [existing] = await tx`
      select * from app.withdrawal_wallets
      where user_id = ${auth.userId} and network_code = ${network} and lower(address) = lower(${clean})
        and coalesce(memo, '') = ${cleanMemo || ''} and status <> 'removed'
      order by (status = 'active') desc limit 1 for update`;
    if (existing?.status === 'active') return existing;
    let walletId = existing?.id;
    if (!walletId) {
      const label = `${an.tokenStandard || an.networkName || network} ${clean.slice(0, 6)}…${clean.slice(-4)}`.slice(0, 60);
      const [row] = await tx`
        select * from app.add_withdrawal_wallet(${auth.userId}, ${label}, ${asset}, ${network}, ${clean}, ${cleanMemo}, ${ctx.ipHash})`;
      walletId = row.id;
      await recordSecurityEvent(tx, { userId: auth.userId, type: 'wallet_added', ipHash: ctx.ipHash, userAgent: ctx.userAgent, metadata: { walletId, network } });
      await tx`select app.notify(${auth.userId}, 'wallet_added', ${tx.json({ label, network })}, '/withdrawals')`;
    }
    const [active] = await tx`select * from app.confirm_withdrawal_wallet(${auth.userId}, ${walletId}, ${ctx.ipHash})`;
    await recordSecurityEvent(tx, { userId: auth.userId, type: 'wallet_confirmed', ipHash: ctx.ipHash, userAgent: ctx.userAgent, metadata: { walletId, emailCode: false } });
    return active;
  });
}

export async function confirmWallet(auth, walletId, code, ctx) {
  return withTransaction(async (tx) => {
    const [vc] = await tx`
      select * from app.verification_codes
      where user_id = ${auth.userId} and purpose = 'wallet_confirmation' and reference_id = ${walletId} and consumed_at is null
      order by created_at desc limit 1 for update`;
    if (!vc || new Date(vc.expires_at) <= new Date()) throw new AppError('code_expired', { status: 422 });
    if (vc.attempts >= 5) throw new AppError('too_many_attempts', { status: 429 });
    if (!timingSafeEqualString(vc.code_hash, sha256Hex(`${walletId}:${code}`))) {
      await tx`update app.verification_codes set attempts = attempts + 1 where id = ${vc.id}`;
      throw new AppError('code_invalid', { status: 422 });
    }
    await tx`update app.verification_codes set consumed_at = now() where id = ${vc.id}`;
    const [row] = await tx`select * from app.confirm_withdrawal_wallet(${auth.userId}, ${walletId}, ${ctx.ipHash})`;
    await recordSecurityEvent(tx, { userId: auth.userId, type: 'wallet_confirmed', ipHash: ctx.ipHash, userAgent: ctx.userAgent, metadata: { walletId } });
    return toApi(row);
  });
}

export async function resendCode(auth, walletId) {
  await withTransaction(async (tx) => {
    const [w] = await tx`select * from app.withdrawal_wallets where id = ${walletId} and user_id = ${auth.userId} and status = 'pending_confirmation'`;
    if (!w) throw new AppError('not_found');
    const code = await sendCode(tx, auth, walletId);
    await queueEmail(tx, {
      to: auth.email,
      template: 'wallet_confirmation',
      locale: auth.profile.locale,
      params: { code, label: w.label, network: w.network_code, address: w.address, minutes: CODE_TTL_MINUTES },
    });
  });
  await dispatchSoon();
  return { sent: true };
}

export async function setDefault(auth, walletId) {
  return withTransaction(async (tx) => {
    const [row] = await tx`select * from app.set_default_withdrawal_wallet(${auth.userId}, ${walletId})`;
    return toApi(row);
  });
}

export async function removeWallet(auth, walletId, ctx) {
  return withTransaction(async (tx) => {
    const [row] = await tx`select * from app.remove_withdrawal_wallet(${auth.userId}, ${walletId}, ${ctx.ipHash})`;
    await recordSecurityEvent(tx, { userId: auth.userId, type: 'wallet_removed', ipHash: ctx.ipHash, userAgent: ctx.userAgent, metadata: { walletId } });
    return toApi(row);
  });
}
