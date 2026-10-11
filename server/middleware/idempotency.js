// HTTP idempotency for financial POST requests (Idempotency-Key header).
// - same key + same body  -> the stored response is replayed (double clicks,
//   retries after a dropped connection, page reloads)
// - same key + different body -> 422
// - same key while the first request is still running -> 409
// The services pass the key down to the database as a second, transactional
// guarantee (unique constraints on the domain tables and ledger).

import { AppError } from '../core/errors.js';
import { getSql } from '../db/client.js';
import { sha256Hex } from '../security/crypto.js';

const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function idempotency(scope) {
  return async (req, res, next) => {
    try {
      const key = req.get('idempotency-key');
      if (!key) throw new AppError('idempotency_key_required');
      if (!KEY_RE.test(key)) throw new AppError('validation_failed', { details: [{ path: 'Idempotency-Key', code: 'invalid' }] });
      const userId = req.auth.userId;
      const requestHash = sha256Hex(`${req.method} ${req.originalUrl.split('?')[0]} ${JSON.stringify(req.body ?? {})}`);
      const sql = getSql();

      const inserted = await sql`
        insert into app.idempotency_keys (user_id, scope, key, request_hash)
        values (${userId}, ${scope}, ${key}, ${requestHash})
        on conflict do nothing
        returning key`;

      if (inserted.length === 0) {
        const [existing] = await sql`
          select request_hash, status, response_status, response_body from app.idempotency_keys
          where user_id = ${userId} and scope = ${scope} and key = ${key}`;
        if (!existing) throw new AppError('conflict');
        if (existing.request_hash !== requestHash) throw new AppError('idempotency_key_reuse');
        if (existing.status !== 'completed') throw new AppError('request_in_progress');
        res.setHeader('Idempotent-Replay', 'true');
        return res.status(existing.response_status).json(existing.response_body);
      }

      req.idempotencyKey = key;
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        const status = res.statusCode;
        const persist =
          status < 500
            ? sql`
                update app.idempotency_keys
                set status = 'completed', response_status = ${status}, response_body = ${sql.json(body ?? null)}, completed_at = now()
                where user_id = ${userId} and scope = ${scope} and key = ${key}`
            : sql`delete from app.idempotency_keys where user_id = ${userId} and scope = ${scope} and key = ${key}`;
        persist.then(
          () => originalJson(body),
          () => originalJson(body),
        );
        return res;
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
