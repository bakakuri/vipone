// TOTP (RFC 6238 vectors), JWT verification, password hashing, encryption,
// address checksums.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decrypt, encrypt, hashPassword, timingSafeEqualString, verifyPassword } from '../../server/security/crypto.js';
import { JwtError, signHs256, verifyJwt } from '../../server/security/jwt.js';
import { base32Encode, hotp, totp, verifyTotp } from '../../server/security/totp.js';
import { encodeBase58Check, isValidEip55, verifyAddressChecksum } from '../../server/utils/address-checksum.js';

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('TOTP matches RFC 6238 test vectors (SHA-1, 6 digits)', () => {
  // RFC 6238 lists 8-digit codes; the last 6 digits are the 6-digit codes.
  assert.equal(totp(RFC_SECRET, 59 * 1000), '287082');
  assert.equal(totp(RFC_SECRET, 1111111109 * 1000), '081804');
  assert.equal(totp(RFC_SECRET, 1234567890 * 1000), '005924');
  assert.equal(totp(RFC_SECRET, 2000000000 * 1000), '279037');
  assert.equal(hotp(RFC_SECRET, 0), '755224'); // RFC 4226 vector
});

test('TOTP verification accepts ±1 step and refuses a reused step', () => {
  const now = 1_700_000_000_000;
  const code = totp(RFC_SECRET, now);
  const step = verifyTotp(RFC_SECRET, code, { nowMs: now });
  assert.ok(step);
  assert.equal(verifyTotp(RFC_SECRET, code, { nowMs: now, lastUsedStep: step }), null, 'replay refused');
  assert.ok(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30000), { nowMs: now }), 'previous step accepted');
  assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 90000), { nowMs: now }), null, 'old code refused');
  assert.equal(verifyTotp(RFC_SECRET, 'abcdef', { nowMs: now }), null);
});

test('JWT: valid HS256 accepted; tampered, expired, "none" and wrong-key tokens refused', async () => {
  const secret = 'unit-test-secret-0123456789abcdef';
  const token = signHs256({ sub: 'user-1', role: 'authenticated' }, secret, { expiresInSeconds: 60 });
  const payload = await verifyJwt(token, { hsSecret: secret });
  assert.equal(payload.sub, 'user-1');
  const [h, p] = token.split('.');
  const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64url')}.${token.split('.')[2]}`;
  await assert.rejects(verifyJwt(tampered, { hsSecret: secret }), JwtError);
  await assert.rejects(verifyJwt(token, { hsSecret: 'another-secret-0123456789abcdefgh' }), JwtError);
  const expired = signHs256({ sub: 'x' }, secret, { expiresInSeconds: 1, now: 1000 });
  await assert.rejects(verifyJwt(expired, { hsSecret: secret }), JwtError);
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`;
  await assert.rejects(verifyJwt(none, { hsSecret: secret }), JwtError);
});

test('passwords are hashed with a salt and verified in constant time', () => {
  const stored = hashPassword('Correct-Horse-42!');
  assert.notEqual(stored, hashPassword('Correct-Horse-42!'), 'salted');
  assert.equal(stored.includes('Correct-Horse'), false);
  assert.equal(verifyPassword('Correct-Horse-42!', stored), true);
  assert.equal(verifyPassword('correct-horse-42!', stored), false);
  assert.equal(timingSafeEqualString('abc', 'abc'), true);
  assert.equal(timingSafeEqualString('abc', 'abd'), false);
});

test('encryption at rest round-trips and is bound to its purpose', () => {
  const secret = 'unit-test-secret-0123456789abcdef';
  const box = encrypt('JBSWY3DPEHPK3PXP', secret, 'ledgerline:mfa');
  assert.equal(box.includes('JBSWY3DPEHPK3PXP'), false);
  assert.equal(decrypt(box, secret, 'ledgerline:mfa'), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => decrypt(box, secret, 'ledgerline:other'));
});

test('address checksums: TRON, EVM (EIP-55), Bitcoin legacy and bech32', () => {
  assert.equal(verifyAddressChecksum('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), true);
  assert.equal(verifyAddressChecksum('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'), false);
  assert.equal(isValidEip55('0xdAC17F958D2ee523a2206206994597C13D831ec7'), true);
  assert.equal(isValidEip55('0xdAc17F958D2ee523a2206206994597C13D831ec7'), false);
  assert.equal(verifyAddressChecksum('evm', '0xdac17f958d2ee523a2206206994597c13d831ec7'), true, 'all-lowercase has no checksum');
  assert.equal(verifyAddressChecksum('bitcoin', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'), true);
  assert.equal(verifyAddressChecksum('bitcoin', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3'), false);
  assert.equal(verifyAddressChecksum('bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), true);
  assert.equal(verifyAddressChecksum('bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdr'), false);
  const generated = encodeBase58Check(0x41, Buffer.alloc(20, 7));
  assert.equal(verifyAddressChecksum('tron', generated), true);
});
