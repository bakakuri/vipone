// Structured JSON logging (one line per event) — Vercel collects stdout.
// Sensitive keys are redacted before anything is written.

import { AsyncLocalStorage } from 'node:async_hooks';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT = /pass(word)?|secret|token|authorization|cookie|code|otp|seed|private|key$/i;

export const requestContext = new AsyncLocalStorage();

let threshold = LEVELS.info;
let silent = false;

export function configureLogger({ level = 'info', quiet = false } = {}) {
  threshold = LEVELS[level] ?? LEVELS.info;
  silent = quiet;
}

export function redact(value, depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT.test(k) && k !== 'code' ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function write(level, msg, fields) {
  if (silent || LEVELS[level] < threshold) return;
  const ctx = requestContext.getStore();
  const line = {
    level,
    time: new Date().toISOString(),
    msg,
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.userId ? { userId: ctx.userId } : {}),
    ...redact(fields || {}),
  };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
}

export const logger = {
  debug: (msg, fields) => write('debug', msg, fields),
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};

export function serializeError(err) {
  if (!err) return undefined;
  return {
    name: err.name,
    message: err.message,
    code: err.code,
    stack: err.stack?.split('\n').slice(0, 8).join('\n'),
  };
}
