// Single source for HTTP security headers. Used by:
//   - Express (helmet) for API responses and the local dev server
//   - scripts/generate-vercel-config.js for static files served by Vercel's CDN
// (Static files on Vercel never pass through Express, so helmet alone would
// leave the HTML pages without a CSP.)

export function contentSecurityPolicy({ supabaseUrl } = {}) {
  const connect = ["'self'"];
  if (supabaseUrl) {
    const host = new URL(supabaseUrl).host;
    connect.push(`https://${host}`, `wss://${host}`);
  } else {
    connect.push('https://*.supabase.co', 'wss://*.supabase.co');
  }
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': connect,
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'manifest-src': ["'self'"],
    'worker-src': ["'self'"],
    'upgrade-insecure-requests': [],
  };
}

export function cspHeaderValue(opts) {
  return Object.entries(contentSecurityPolicy(opts))
    .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
    .join('; ');
}

export const STATIC_SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
