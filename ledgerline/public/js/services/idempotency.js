// One idempotency key per user action. Retrying the same action (double
// click, network retry, page reload of a pending form) reuses the key, so the
// server performs the operation at most once.
export function newIdempotencyKey() {
  return crypto.randomUUID();
}

export function createActionKey() {
  let key = newIdempotencyKey();
  return {
    get: () => key,
    reset: () => {
      key = newIdempotencyKey();
    },
  };
}
