// Password policy, shared by the browser and the server. The server is
// authoritative; the browser uses the same rules to explain them live.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULES = [
  { id: 'length', test: (pw) => pw.length >= PASSWORD_MIN_LENGTH && pw.length <= PASSWORD_MAX_LENGTH },
  { id: 'lowercase', test: (pw) => /\p{Ll}/u.test(pw) },
  { id: 'uppercase', test: (pw) => /\p{Lu}/u.test(pw) },
  { id: 'digit', test: (pw) => /\p{Nd}/u.test(pw) },
  { id: 'symbol', test: (pw) => /[^\p{L}\p{Nd}\s]/u.test(pw) },
];

const COMMON = new Set([
  'password1234', 'qwerty123456', '123456789012', 'letmein12345', 'administrator',
  'welcome12345', 'iloveyou1234', 'password123!', 'Password123!', 'Qwerty123456!',
]);

/** Returns the ids of the rules the password fails (empty array = valid). */
export function checkPassword(password, email = '') {
  const pw = String(password ?? '');
  const failed = PASSWORD_RULES.filter((rule) => !rule.test(pw)).map((rule) => rule.id);
  const local = String(email).split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && pw.toLowerCase().includes(local)) failed.push('not_email');
  if (COMMON.has(pw)) failed.push('not_common');
  return failed;
}

export function validatePassword(password, email) {
  if (!password) return 'required';
  return checkPassword(password, email).length ? 'password_weak' : null;
}
