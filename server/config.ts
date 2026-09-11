export interface AppConfig {
  port: number;
  redisUrl: string;
  corsOrigin: string;
  corsOrigins: string[];
  turnstileSecretKey: string;
  turnstileAllowedHostnames: string[];
  turnstileAction: string;
  isProduction: boolean;
  allowTurnstileBypass: boolean;
  maxPayloadSize: number;
  maxPlaintextBytes: number;
  maxCiphertextBytes: number;
  rateLimitTimeWindow: number;
  createRateLimitMax: number;
  metaRateLimitMax: number;
  revealRateLimitMax: number;
  burnRateLimitMax: number;
  statusTtlSeconds: number;
  trustedProxyIps: string[];
  hstsMaxAgeSeconds: number;
}

const TEST_TURNSTILE_SECRET_KEYS = new Set([
  '1x0000000000000000000000000000000AA',
  '1x00000000000000000000AA'
]);

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function listFromEnv(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  const configuredCorsOrigin = env.CORS_ORIGIN?.trim() || '';
  const corsOrigin = configuredCorsOrigin || (isProduction ? '' : 'http://localhost:3000');
  const corsOrigins = listFromEnv(corsOrigin);
  const maxPlaintextBytes = 100 * 1024;

  // V2 envelopes prefix the AES-GCM IV and authentication tag with one
  // version byte before base64 encoding.
  const maxCiphertextBytes = 1 + 12 + maxPlaintextBytes + 16;

  return {
    port: positiveInteger(env.PORT, 3001),
    redisUrl: env.REDIS_URL || 'redis://localhost:6379',
    corsOrigin,
    corsOrigins,
    turnstileSecretKey: env.TURNSTILE_SECRET_KEY?.trim() || '',
    turnstileAllowedHostnames: listFromEnv(env.TURNSTILE_ALLOWED_HOSTNAMES),
    turnstileAction: env.TURNSTILE_ACTION?.trim() || '',
    isProduction,
    allowTurnstileBypass: !isProduction && env.ALLOW_TURNSTILE_BYPASS === '1',
    maxPayloadSize: 256 * 1024,
    maxPlaintextBytes,
    maxCiphertextBytes,
    rateLimitTimeWindow: positiveInteger(env.RATE_LIMIT_TIME_WINDOW_MS, 60 * 60 * 1000),
    createRateLimitMax: positiveInteger(env.CREATE_RATE_LIMIT_MAX, 100),
    metaRateLimitMax: positiveInteger(env.META_RATE_LIMIT_MAX, 300),
    revealRateLimitMax: positiveInteger(env.REVEAL_RATE_LIMIT_MAX, 100),
    burnRateLimitMax: positiveInteger(env.BURN_RATE_LIMIT_MAX, 100),
    statusTtlSeconds: positiveInteger(env.STATUS_TTL_SECONDS, 60 * 60),
    trustedProxyIps: listFromEnv(env.TRUSTED_PROXY_IPS),
    hstsMaxAgeSeconds: positiveInteger(env.HSTS_MAX_AGE_SECONDS, 24 * 60 * 60)
  };
}

export function assertProductionConfig(value: AppConfig): void {
  if (!value.isProduction) return;

  if (!value.turnstileSecretKey || TEST_TURNSTILE_SECRET_KEYS.has(value.turnstileSecretKey)) {
    throw new Error(
      'Production requires TURNSTILE_SECRET_KEY to be set to a real Cloudflare Turnstile secret.'
    );
  }

  if (!value.corsOrigins.length || value.corsOrigins.includes('*')) {
    throw new Error('Production requires CORS_ORIGIN to be an explicit origin allowlist; wildcard CORS is disabled.');
  }

  if (!value.turnstileAllowedHostnames.length) {
    throw new Error('Production requires TURNSTILE_ALLOWED_HOSTNAMES to validate Turnstile responses.');
  }

  if (value.allowTurnstileBypass) {
    throw new Error('Turnstile bypass must be disabled in production.');
  }
}

export const config = loadConfig();
