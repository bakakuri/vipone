// Validation shared by browser and server, and exact decimal helpers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareDecimal } from '../../public/js/validation/compare-decimal.js';
import { checkPassword, validatePassword } from '../../public/js/validation/password-rules.js';
import { percentToRate } from '../../public/js/validation/percent-to-rate.js';
import { normalizeAmountInput, validateAmount } from '../../public/js/validation/validate-amount.js';
import { normalizeEmail, validateEmail } from '../../public/js/validation/validate-email.js';
import { validateWalletAddress } from '../../public/js/validation/validate-wallet-address.js';

test('amounts: accepted formats, locale input, precision, no exponent', () => {
  assert.equal(normalizeAmountInput(' 1 234,50 '), '1234.50');
  assert.equal(normalizeAmountInput('١٢٣٫٤'), '123.4');
  assert.equal(validateAmount('125.50'), null);
  assert.equal(validateAmount('0'), 'amount_positive');
  assert.equal(validateAmount('0', { allowZero: true }), null);
  assert.equal(validateAmount('1e9'), 'amount_invalid');
  assert.equal(validateAmount('-5'), 'amount_invalid');
  assert.equal(validateAmount('01.5'), 'amount_invalid');
  assert.equal(validateAmount('1.1234567', { decimals: 6 }), 'amount_precision');
  assert.equal(validateAmount(''), 'required');
});

test('emails are normalised and validated', () => {
  assert.equal(normalizeEmail('  Name@Example.ORG '), 'name@example.org');
  assert.equal(validateEmail('name@example.org'), null);
  assert.equal(validateEmail('name@'), 'email_invalid');
  assert.equal(validateEmail(''), 'required');
});

test('password policy matches on both sides', () => {
  assert.deepEqual(checkPassword('Correct-Horse-42!'), []);
  assert.ok(checkPassword('short').includes('length'));
  assert.ok(checkPassword('alllowercase-123!').includes('uppercase'));
  assert.ok(checkPassword('Johnsmith-2026!', 'johnsmith@example.org').includes('not_email'));
  assert.equal(validatePassword('Correct-Horse-42!'), null);
  assert.equal(validatePassword(''), 'required');
});

test('wallet addresses follow the network rules from the database', () => {
  const tron = { addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$' };
  const ton = { addressPattern: '^(EQ|UQ)[A-Za-z0-9_-]{46}$', memoRequired: true, memoPattern: '^[0-9]{6,20}$' };
  assert.equal(validateWalletAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', tron), null);
  assert.equal(validateWalletAddress('0xdac17f958d2ee523a2206206994597c13d831ec7', tron), 'address_invalid');
  assert.equal(validateWalletAddress('', tron), 'required');
  const tonAddr = `EQ${'A'.repeat(46)}`;
  assert.equal(validateWalletAddress(tonAddr, ton), 'memo_required');
  assert.equal(validateWalletAddress(tonAddr, ton, 'abc'), 'memo_invalid');
  assert.equal(validateWalletAddress(tonAddr, ton, '1234567'), null);
});

test('decimal comparison and percent conversion are exact', () => {
  assert.equal(compareDecimal('100', '99.999999'), 1);
  assert.equal(compareDecimal('0.1', '0.10'), 0);
  assert.equal(compareDecimal('-0.5', '0.1'), -1);
  assert.equal(compareDecimal('-2', '-10'), 1);
  assert.equal(compareDecimal('0', '-0'), 0);
  assert.equal(percentToRate('1.25'), '0.0125');
  assert.equal(percentToRate('-0.4'), '-0.004');
  assert.equal(percentToRate('10'), '0.1');
  assert.equal(percentToRate('100'), null);
  assert.equal(percentToRate('1e2'), null);
});
