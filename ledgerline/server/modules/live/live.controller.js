// Live Mode endpoints.
//  GET /live/config  -> which transport the browser should use
//  GET /live/token   -> short-lived access token for Supabase Realtime, kept in
//                       browser memory only (never in localStorage); it can only
//                       join the user's own private channel (RLS on realtime.messages)
//  GET /live/stream  -> Server-Sent Events fallback (local development)
// Events carry ids and statuses only; the browser re-fetches data from the API.

import { getConfig } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { sendData } from '../../core/respond.js';
import { getSql } from '../../db/client.js';
import { cookieNames } from '../../middleware/cookies.js';
import { getSetting } from '../settings/settings.service.js';
import { ensureListening, subscribe } from './live-bus.js';

function topicsFor(auth) {
  return [`user:${auth.userId}`, ...(auth.isStaff ? ['admin:ops'] : [])];
}

export async function config(req, res) {
  const cfg = getConfig();
  const enabled = (await getSetting(getSql(), 'live.enabled', true)) !== false;
  sendData(res, {
    enabled,
    transport: cfg.live.transport,
    topics: topicsFor(req.auth),
    realtime: cfg.live.transport === 'supabase' ? { url: cfg.auth.supabaseUrl, publishableKey: cfg.auth.publishableKey } : null,
  });
}

export async function token(req, res) {
  const cfg = getConfig();
  if (cfg.live.transport !== 'supabase') throw new AppError('feature_unavailable');
  const accessToken = req.cookies[cookieNames(cfg).access];
  sendData(res, { accessToken, expiresAt: req.auth.expiresAt ?? null });
}

export async function stream(req, res) {
  const cfg = getConfig();
  if ((await getSetting(getSql(), 'live.enabled', true)) === false) throw new AppError('feature_unavailable');
  await ensureListening();

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  write('hello', { serverTime: new Date().toISOString(), topics: topicsFor(req.auth) });
  res.write('retry: 3000\n\n');

  const unsubscribers = topicsFor(req.auth).map((topic) =>
    subscribe(topic, (evt) => write('update', { topic: evt.topic, event: evt.event, payload: evt.payload })),
  );
  const heartbeat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 20000);
  // Close before the serverless time limit; EventSource reconnects by itself.
  const maxLife = setTimeout(() => res.end(), cfg.live.sseMaxSeconds * 1000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clearTimeout(maxLife);
    unsubscribers.forEach((u) => u());
  });
}
