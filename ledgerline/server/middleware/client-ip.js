import { hashIp } from '../security/crypto.js';

// Express resolves req.ip through `trust proxy` (Vercel adds X-Forwarded-For).
export function clientIp(req) {
  return req.get('x-real-ip') || req.ip || req.socket?.remoteAddress || null;
}

export function clientIpHash(req, config) {
  return hashIp(clientIp(req), config.ipHashSecret);
}

export function userAgent(req) {
  return (req.get('user-agent') || '').slice(0, 300) || null;
}
