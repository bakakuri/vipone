// Environment configuration. Validated once at start-up; the process refuses
// to start with an unsafe combination (fail closed). Secrets are read only
// from environment variables — never from files committed to the repository.

import { z } from 'zod';

const bool = (fallback) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === true || v === 'true' || v === '1'));

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []));

const json = (fallback) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return fallback;
      try {
        return JSON.parse(v);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be valid JSON' });
        return z.NEVER;
      }
    });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_MODE: z.enum(['demo', 'live']).default('demo'),
  APP_NAME: z.string().min(2).max(40).default('Ledgerline'),
  APP_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: csv,
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(10),
  DATABASE_URL_DIRECT: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  DB_PREPARE: bool(false),

  AUTH_PROVIDER: z.enum(['supabase', 'local']).optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  LOCAL_JWT_SECRET: z.string().optional(),

  COOKIE_SECURE: bool(undefined),
  COOKIE_DOMAIN: z.string().optional(),
  IP_HASH_SECRET: z.string().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

  EMAIL_PROVIDER: z.enum(['log', 'resend', 'postmark']).default('log'),
  EMAIL_FROM: z.string().default('Ledgerline <no-reply@example.com>'),
  RESEND_API_KEY: z.string().optional(),
  POSTMARK_SERVER_TOKEN: z.string().optional(),

  BLOCKCHAIN_WEBHOOK_SECRET: z.string().optional(),
  ALCHEMY_WEBHOOK_SIGNING_KEYS: csv,
  ALCHEMY_NETWORK_MAP: json({ 'ETH_MAINNET': 'ETHEREUM' }),
  CHAIN_RPC_URLS: json({}),

  SCREENING_PROVIDER: z.enum(['none', 'http']).default('none'),
  SCREENING_API_URL: z.string().url().optional(),
  SCREENING_API_KEY: z.string().optional(),

  KYC_PROVIDER: z.enum(['manual', 'sumsub']).default('manual'),
  SUMSUB_APP_TOKEN: z.string().optional(),
  SUMSUB_SECRET_KEY: z.string().optional(),
  SUMSUB_LEVEL_NAME: z.string().default('basic-kyc-level'),
  SUMSUB_WEBHOOK_SECRET: z.string().optional(),
  SUMSUB_BASE_URL: z.string().url().default('https://api.sumsub.com'),

  PRICE_PROVIDER: z.enum(['static', 'coingecko']).default('static'),
  PRICE_STATIC: json({ USDT: '1', USDC: '1' }),
  COINGECKO_API_KEY: z.string().optional(),

  CRON_SECRET: z.string().optional(),
  LIVE_TRANSPORT: z.enum(['supabase', 'sse']).optional(),
  LIVE_SSE_MAX_SECONDS: z.coerce.number().int().min(30).max(800).default(240),
  RATE_LIMIT_STORE: z.enum(['postgres', 'memory']).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ERROR_WEBHOOK_URL: z.string().url().optional(),
  DEMO_TOOLS_ENABLED: bool(false),
  LEGAL_APPROVAL_CONFIRMED: bool(false),
  // Staff must use two-factor authentication in production. May be switched
  // off only outside live mode (e.g. while setting up a demo).
  STAFF_MFA_REQUIRED: bool(true),
});

function fail(errors) {
  const err = new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  err.code = 'invalid_configuration';
  throw err;
}

// "vipone.vercel.app", " https://vipone.vercel.app/ " -> "https://vipone.vercel.app"
export function normalizeUrl(value) {
  if (value === undefined || value === null) return value;
  let v = String(value).trim().replace(/\/+$/, '');
  if (v && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  return v;
}

// Deployment URLs Vercel provides (system environment variables).
function vercelOrigins(env) {
  return ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_BRANCH_URL', 'VERCEL_URL']
    .map((k) => (env[k] ? normalizeUrl(env[k]) : null))
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  // An empty variable (KEY= in .env or an empty value in Vercel) means "not set".
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && String(v).trim() !== ''));
  // APP_URL: tolerate a missing scheme or trailing slash; on Vercel fall back
  // to the project's production domain when it is not set.
  if (!present.APP_URL && present.VERCEL_PROJECT_PRODUCTION_URL) present.APP_URL = present.VERCEL_PROJECT_PRODUCTION_URL;
  if (present.APP_URL) present.APP_URL = normalizeUrl(present.APP_URL);
  if (present.SUPABASE_URL) present.SUPABASE_URL = normalizeUrl(present.SUPABASE_URL);
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    fail(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const live = e.APP_MODE === 'live';
  const authProvider = e.AUTH_PROVIDER ?? (production ? 'supabase' : 'local');
  const appUrl = (e.APP_URL ?? `http://localhost:${e.PORT}`).replace(/\/$/, '');
  const cookieSecure = e.COOKIE_SECURE ?? (production || appUrl.startsWith('https://'));
  const liveTransport = e.LIVE_TRANSPORT ?? (authProvider === 'supabase' && e.SUPABASE_URL ? 'supabase' : 'sse');

  const errors = [];
  if (authProvider === 'supabase') {
    if (!e.SUPABASE_URL) errors.push('SUPABASE_URL is required when AUTH_PROVIDER=supabase');
    if (!e.SUPABASE_PUBLISHABLE_KEY) errors.push('SUPABASE_PUBLISHABLE_KEY is required when AUTH_PROVIDER=supabase');
  }
  if (authProvider === 'local') {
    if (production) errors.push('AUTH_PROVIDER=local is for development and tests only');
    if (!e.LOCAL_JWT_SECRET || e.LOCAL_JWT_SECRET.length < 32) errors.push('LOCAL_JWT_SECRET (32+ characters) is required for AUTH_PROVIDER=local');
  }
  if (liveTransport === 'supabase' && (!e.SUPABASE_URL || !e.SUPABASE_PUBLISHABLE_KEY)) {
    errors.push('LIVE_TRANSPORT=supabase needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY');
  }
  if (e.EMAIL_PROVIDER === 'resend' && !e.RESEND_API_KEY) errors.push('RESEND_API_KEY is required for EMAIL_PROVIDER=resend');
  if (e.EMAIL_PROVIDER === 'postmark' && !e.POSTMARK_SERVER_TOKEN) errors.push('POSTMARK_SERVER_TOKEN is required for EMAIL_PROVIDER=postmark');
  if (e.SCREENING_PROVIDER === 'http' && (!e.SCREENING_API_URL || !e.SCREENING_API_KEY)) {
    errors.push('SCREENING_API_URL and SCREENING_API_KEY are required for SCREENING_PROVIDER=http');
  }
  if (e.KYC_PROVIDER === 'sumsub' && (!e.SUMSUB_APP_TOKEN || !e.SUMSUB_SECRET_KEY || !e.SUMSUB_WEBHOOK_SECRET)) {
    errors.push('SUMSUB_APP_TOKEN, SUMSUB_SECRET_KEY and SUMSUB_WEBHOOK_SECRET are required for KYC_PROVIDER=sumsub');
  }
  if (production) {
    if (!e.APP_URL) errors.push('APP_URL is required in production');
    if (!e.IP_HASH_SECRET || e.IP_HASH_SECRET.length < 32) errors.push('IP_HASH_SECRET (32+ characters) is required in production');
    if (!e.CRON_SECRET || e.CRON_SECRET.length < 32) errors.push('CRON_SECRET (32+ characters) is required in production');
    if ((e.RATE_LIMIT_STORE ?? 'postgres') !== 'postgres') errors.push('RATE_LIMIT_STORE must be postgres in production (memory is per-instance)');
    if (!cookieSecure) errors.push('COOKIE_SECURE cannot be disabled in production');
    if (/@example\.(com|org|net)>?$/i.test(e.EMAIL_FROM)) errors.push('EMAIL_FROM must be your own verified sender address in production');
  }
  // Real money: every safeguard must be configured, or the process stops.
  if (live) {
    if (authProvider !== 'supabase') errors.push('APP_MODE=live requires AUTH_PROVIDER=supabase');
    if (e.EMAIL_PROVIDER === 'log') errors.push('APP_MODE=live requires a real EMAIL_PROVIDER');
    if (e.SCREENING_PROVIDER === 'none') errors.push('APP_MODE=live requires wallet screening (SCREENING_PROVIDER)');
    if (e.KYC_PROVIDER === 'manual') errors.push('APP_MODE=live requires a KYC provider (KYC_PROVIDER=sumsub)');
    if (e.DEMO_TOOLS_ENABLED) errors.push('DEMO_TOOLS_ENABLED must be false in APP_MODE=live');
    if (e.PRICE_PROVIDER === 'static') errors.push('APP_MODE=live requires market prices (PRICE_PROVIDER=coingecko)');
    if (!e.LEGAL_APPROVAL_CONFIRMED) errors.push('APP_MODE=live requires LEGAL_APPROVAL_CONFIRMED=true (licensing and legal review completed)');
    if (!appUrl.startsWith('https://')) errors.push('APP_MODE=live requires an https APP_URL');
    if (!e.BLOCKCHAIN_WEBHOOK_SECRET && e.ALCHEMY_WEBHOOK_SIGNING_KEYS.length === 0) errors.push('APP_MODE=live requires a blockchain webhook secret');
    if (!e.STAFF_MFA_REQUIRED) errors.push('APP_MODE=live requires STAFF_MFA_REQUIRED=true (two-factor authentication for staff)');
  }
  if (e.DEMO_TOOLS_ENABLED && live) errors.push('Demo tools cannot run with real money');
  if (errors.length) fail(errors);

  return Object.freeze({
    env: e.NODE_ENV,
    isProduction: production,
    isTest: e.NODE_ENV === 'test',
    mode: e.APP_MODE,
    isLive: live,
    appName: e.APP_NAME,
    appUrl,
    // The site's own URL plus this project's Vercel deployment URLs.
    allowedOrigins: [...new Set([...(e.ALLOWED_ORIGINS.length ? e.ALLOWED_ORIGINS.map(normalizeUrl) : [appUrl]), ...vercelOrigins(present)])],
    port: e.PORT,
    db: {
      url: e.DATABASE_URL,
      directUrl: e.DATABASE_URL_DIRECT || e.DATABASE_URL,
      poolMax: e.DB_POOL_MAX,
      prepare: e.DB_PREPARE,
    },
    auth: {
      provider: authProvider,
      supabaseUrl: e.SUPABASE_URL?.replace(/\/$/, ''),
      publishableKey: e.SUPABASE_PUBLISHABLE_KEY,
      secretKey: e.SUPABASE_SECRET_KEY,
      supabaseJwtSecret: e.SUPABASE_JWT_SECRET,
      localJwtSecret: e.LOCAL_JWT_SECRET,
    },
    cookies: {
      secure: cookieSecure,
      domain: e.COOKIE_DOMAIN,
      // __Host- prefix forces Secure + Path=/ + no Domain (strongest binding).
      prefix: cookieSecure && !e.COOKIE_DOMAIN ? '__Host-' : '',
    },
    ipHashSecret: e.IP_HASH_SECRET || 'development-only-ip-hash-secret-change-me',
    trustProxy: e.TRUST_PROXY,
    email: {
      provider: e.EMAIL_PROVIDER,
      from: e.EMAIL_FROM,
      resendApiKey: e.RESEND_API_KEY,
      postmarkToken: e.POSTMARK_SERVER_TOKEN,
    },
    blockchain: {
      webhookSecret: e.BLOCKCHAIN_WEBHOOK_SECRET,
      alchemySigningKeys: e.ALCHEMY_WEBHOOK_SIGNING_KEYS,
      alchemyNetworkMap: e.ALCHEMY_NETWORK_MAP,
      rpcUrls: e.CHAIN_RPC_URLS,
    },
    screening: { provider: e.SCREENING_PROVIDER, url: e.SCREENING_API_URL, apiKey: e.SCREENING_API_KEY },
    kyc: {
      provider: e.KYC_PROVIDER,
      sumsub: {
        appToken: e.SUMSUB_APP_TOKEN,
        secretKey: e.SUMSUB_SECRET_KEY,
        levelName: e.SUMSUB_LEVEL_NAME,
        webhookSecret: e.SUMSUB_WEBHOOK_SECRET,
        baseUrl: e.SUMSUB_BASE_URL,
      },
    },
    prices: { provider: e.PRICE_PROVIDER, staticPrices: e.PRICE_STATIC, coingeckoKey: e.COINGECKO_API_KEY },
    cronSecret: e.CRON_SECRET,
    live: { transport: liveTransport, sseMaxSeconds: e.LIVE_SSE_MAX_SECONDS },
    rateLimitStore: e.RATE_LIMIT_STORE ?? (production ? 'postgres' : 'memory'),
    logLevel: e.LOG_LEVEL,
    errorWebhookUrl: e.ERROR_WEBHOOK_URL,
    demoToolsEnabled: e.DEMO_TOOLS_ENABLED && !live,
    // Staff 2FA: always in live mode; in production unless STAFF_MFA_REQUIRED=false.
    staffMfaRequired: live || (production && e.STAFF_MFA_REQUIRED),
    legalApprovalConfirmed: e.LEGAL_APPROVAL_CONFIRMED,
  });
}

let cached;

export function getConfig() {
  if (!cached) cached = loadConfig();
  return cached;
}

// Tests build an app with explicit configuration.
export function setConfig(config) {
  cached = config;
}
