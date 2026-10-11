// Fixed-window rate limiting. The postgres store is shared by every
// serverless instance (required in production); the memory store is for
// local development and tests only.

import { getConfig } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { getSql } from '../db/client.js';
import { clientIp } from './client-ip.js';
import { hmacSha256 } from '../security/crypto.js';

const memory = new Map();

async function hitMemory(bucket, windowSeconds, max) {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const current = memory.get(bucket);
  const hits = current && current.windowStart === windowStart ? current.hits + 1 : 1;
  memory.set(bucket, { windowStart, hits });
  if (memory.size > 50000) memory.clear();
  return { allowed: hits <= max, remaining: Math.max(max - hits, 0), resetAt: new Date((windowStart + windowSeconds) * 1000) };
}

async function hitPostgres(bucket, windowSeconds, max) {
  const [row] = await getSql()`select * from app.rate_limit_hit(${bucket}, ${windowSeconds}, ${max})`;
  return { allowed: row.allowed, remaining: row.remaining, resetAt: row.reset_at };
}

export function resetRateLimits() {
  memory.clear();
}

/**
 * @param {{name: string, windowSeconds: number, max: number, key?: (req) => string|null}} opts
 * key defaults to the client IP; return null to skip limiting for a request.
 */
export function rateLimit({ name, windowSeconds, max, key }) {
  return async (req, res, next) => {
    try {
      const config = getConfig();
      const rawKey = key ? key(req) : clientIp(req);
      if (rawKey === null || rawKey === undefined) return next();
      const bucket = `${name}:${hmacSha256(config.ipHashSecret, String(rawKey)).slice(0, 24)}`;
      const hit = config.rateLimitStore === 'postgres' ? await hitPostgres(bucket, windowSeconds, max) : await hitMemory(bucket, windowSeconds, max);
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', String(hit.remaining));
      if (!hit.allowed) {
        const retryAfter = Math.max(1, Math.ceil((new Date(hit.resetAt).getTime() - Date.now()) / 1000));
        res.setHeader('Retry-After', String(retryAfter));
        throw new AppError('rate_limited', { details: { retryAfter } });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const byUser = (req) => req.auth?.userId ?? null;
export const byEmail = (req) => (typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : null);
