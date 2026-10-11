// Shared by the browser (instant feedback) and the server (authoritative check).
// Returns null when valid, otherwise an error code from locales/*/errors.json.

const EMAIL_RE = /^[^\s@"'<>()[\]\\,;:]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return 'required';
  if (email.length > 254 || !EMAIL_RE.test(email)) return 'email_invalid';
  return null;
}
