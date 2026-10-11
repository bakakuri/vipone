import helmet from 'helmet';
import { contentSecurityPolicy } from '../config/security-headers.js';

export function securityHeaders(config) {
  const directives = contentSecurityPolicy({ supabaseUrl: config.auth.supabaseUrl });
  if (!config.cookies.secure) delete directives['upgrade-insecure-requests'];
  return helmet({
    contentSecurityPolicy: { useDefaults: false, directives },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' },
    strictTransportSecurity: config.cookies.secure ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
  });
}

export function permissionsPolicy() {
  return (req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  };
}

// API responses carry account data: never cache them in shared caches.
export function noStore() {
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}
