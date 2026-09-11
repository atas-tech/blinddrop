import fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { AppConfig, assertProductionConfig, config } from './config.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ENVELOPE_VERSION = 2;
const MIN_CIPHERTEXT_BYTES = 1 + 12 + 16;
const TOMBSTONE_STATUSES = new Set(['viewed', 'burned']);

const UUID_PARAMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  // Keep length validation in the shared runtime guard so malformed IDs get
  // the required 404 response instead of Fastify's generic 400 validation.
  properties: {
    id: { type: 'string' }
  }
};

const CREATE_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'ciphertext', 'ttl', 'turnstileToken'],
  properties: {
    version: {
      type: 'integer',
      enum: [ENVELOPE_VERSION]
    },
    ciphertext: {
      type: 'string',
      minLength: 40,
      maxLength: 136572,
      pattern: BASE64.source
    },
    ttl: {
      type: 'integer',
      enum: [300, 3600, 86400, 604800]
    },
    turnstileToken: {
      type: 'string',
      minLength: 1,
      maxLength: 2048
    },
    passphrase_salt: {
      type: 'string',
      minLength: 24,
      maxLength: 24,
      pattern: BASE64.source
    }
  }
};

const BURN_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['burnToken'],
  properties: {
    burnToken: {
      type: 'string',
      minLength: 36,
      maxLength: 36,
      pattern: UUID_V4.source
    }
  }
};

const EMPTY_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  maxProperties: 0,
  properties: {}
};

const RATE_LIMIT_SCRIPT = `
  local count = redis.call("INCR", KEYS[1])
  if count == 1 then
    local expiry = redis.pcall("PEXPIRE", KEYS[1], ARGV[1])
    if type(expiry) == "table" and expiry.err then
      redis.call("DEL", KEYS[1])
      return redis.error_reply("RATE_LIMIT_FAILED")
    end
  end
  local ttl = redis.pcall("PTTL", KEYS[1])
  if type(ttl) == "table" and ttl.err then
    return redis.error_reply("RATE_LIMIT_FAILED")
  end
  return { count, ttl }
`;

// New records are one Redis hash with one TTL. The pcall/cleanup path keeps a
// failed capacity write from leaving a live hash without an expiry.
const STORE_SECRET_SCRIPT = `
  local key = KEYS[1]
  local stored = redis.pcall(
    "HSET", key,
    "v", ARGV[1],
    "ciphertext", ARGV[2],
    "burn_hash", ARGV[3]
  )
  if type(stored) == "table" and stored.err then
    return redis.error_reply("STORE_FAILED")
  end

  if ARGV[4] ~= "" then
    local salt = redis.pcall("HSET", key, "salt", ARGV[4])
    if type(salt) == "table" and salt.err then
      redis.call("DEL", key)
      return redis.error_reply("STORE_FAILED")
    end
  end

  local expiry = redis.pcall("EXPIRE", key, ARGV[5])
  if type(expiry) == "table" and expiry.err then
    redis.call("DEL", key)
    return redis.error_reply("STORE_FAILED")
  end

  -- A UUID collision is extraordinarily unlikely, but a stale tombstone must
  -- never make a newly-created record appear terminal.
  redis.call("DEL", key .. ":status")
  return "stored"
`;

// The v2 record is one Redis hash with one TTL. Delivery writes the tombstone
// before deleting the hash, so a capacity error never becomes a false success.
const REVEAL_SECRET_SCRIPT = `
  local key = KEYS[1]
  local status_key = key .. ":status"
  local status = redis.call("GET", status_key)

  if status == "viewed" or status == "burned" then
    return { status }
  end

  if redis.call("TYPE", key).ok ~= "hash" then
    return { "missing" }
  end

  local fields = redis.call("HGETALL", key)
  local version = false
  local ciphertext = false
  local burn_hash = false
  local salt = ""

  for index = 1, #fields, 2 do
    local field = fields[index]
    local value = fields[index + 1]
    if field == "v" then version = value end
    if field == "ciphertext" then ciphertext = value end
    if field == "burn_hash" then burn_hash = value end
    if field == "salt" then salt = value end
  end

  if version ~= ARGV[2] or not ciphertext or not burn_hash then
    return { "invalid" }
  end

  local tombstone = redis.pcall("SETEX", status_key, ARGV[1], "viewed")
  if type(tombstone) == "table" and tombstone.err then
    return redis.error_reply("TOMBSTONE_FAILED")
  end

  redis.call("DEL", key)
  return { "hash", version, ciphertext, salt }
`;

const BURN_SECRET_SCRIPT = `
  local key = KEYS[1]
  local status_key = key .. ":status"
  local status = redis.call("GET", status_key)

  if status == "viewed" or status == "burned" then
    return { "gone", status }
  end

  if redis.call("TYPE", key).ok ~= "hash" then
    return { "missing" }
  end

  if redis.call("HGET", key, "v") ~= ARGV[3] then
    return { "invalid" }
  end

  local expected_hash = redis.call("HGET", key, "burn_hash")
  if not expected_hash then
    return { "missing" }
  end
  if expected_hash ~= ARGV[1] then
    return { "forbidden" }
  end

  local tombstone = redis.pcall("SETEX", status_key, ARGV[2], "burned")
  if type(tombstone) == "table" and tombstone.err then
    return redis.error_reply("TOMBSTONE_FAILED")
  end

  redis.call("DEL", key)
  return { "burned" }
`;

interface ScriptedRedis extends Redis {
  rateLimit(key: string, windowMilliseconds: string): Promise<[number | string, number | string]>;
  storeSecret(
    key: string,
    version: string,
    ciphertext: string,
    burnHash: string,
    salt: string,
    expirySeconds: string
  ): Promise<string>;
  revealSecret(key: string, statusTtlSeconds: string, version: string): Promise<Array<string>>;
  burnSecret(
    key: string,
    burnHash: string,
    statusTtlSeconds: string,
    version: string
  ): Promise<Array<string>>;
}

export interface BuildAppOptions {
  config?: Partial<AppConfig>;
  redisUrl?: string;
  turnstileVerifier?: (token: string, ip: string) => Promise<boolean>;
}

type RateLimitBucket = 'create' | 'meta' | 'reveal' | 'burn';

const RATE_LIMIT_BUCKET_CONFIG: Record<RateLimitBucket, keyof AppConfig> = {
  create: 'createRateLimitMax',
  meta: 'metaRateLimitMax',
  reveal: 'revealRateLimitMax',
  burn: 'burnRateLimitMax'
};

function isSecretId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function decodeCanonicalBase64(value: string): Buffer | null {
  if (!BASE64.test(value) || value.length % 4 !== 0) return null;

  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.toString('base64') === value ? decoded : null;
  } catch {
    return null;
  }
}

function validCiphertext(value: string, maximumBytes: number): boolean {
  const decoded = decodeCanonicalBase64(value);
  return decoded !== null &&
    decoded.byteLength >= MIN_CIPHERTEXT_BYTES &&
    decoded.byteLength <= maximumBytes &&
    decoded[0] === ENVELOPE_VERSION;
}

function validSalt(value: string): boolean {
  const decoded = decodeCanonicalBase64(value);
  return decoded !== null && decoded.byteLength === 16;
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({
    code: 'SECRET_NOT_FOUND',
    error: 'Secret not found or expired.'
  });
}

function terminal(reply: FastifyReply, status: string | null | undefined) {
  if (status === 'viewed') {
    return reply.status(410).send({
      code: 'SECRET_VIEWED',
      error: 'Secret has already been viewed and destroyed.'
    });
  }

  if (status === 'burned') {
    return reply.status(410).send({
      code: 'SECRET_BURNED',
      error: 'Secret was proactively burned by the sender.'
    });
  }

  return notFound(reply);
}

function unavailable(reply: FastifyReply) {
  return reply.status(503).send({
    code: 'SERVICE_UNAVAILABLE',
    error: 'The service is temporarily unable to complete this request. Please try again later.'
  });
}

function stateUnknown(reply: FastifyReply) {
  return reply.status(503).send({
    code: 'SECRET_STATE_UNKNOWN',
    error: 'The server could not safely complete this request. Secret state is unknown; do not refresh or retry automatically.'
  });
}

function setSecurityHeaders(reply: FastifyReply, production: boolean, hstsMaxAgeSeconds: number) {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (production) {
    reply.header('Strict-Transport-Security', `max-age=${hstsMaxAgeSeconds}; includeSubDomains`);
  }
}

export function buildApp(options: BuildAppOptions = {}) {
  const appConfig: AppConfig = {
    ...config,
    ...options.config,
    redisUrl: options.redisUrl ?? options.config?.redisUrl ?? config.redisUrl,
    corsOrigins: options.config?.corsOrigins ?? config.corsOrigins
  };

  assertProductionConfig(appConfig);

  const app = fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      // Do not let Fastify's request/error serializers retain URL params or
      // request bodies. Completion logs below contain only route templates.
      redact: {
        paths: ['req', 'res'],
        censor: '[REDACTED]'
      }
    },
    disableRequestLogging: true,
    trustProxy: appConfig.trustedProxyIps.length > 0 ? appConfig.trustedProxyIps : false,
    bodyLimit: appConfig.maxPayloadSize
  });

  const redis = new Redis(appConfig.redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1
  }) as ScriptedRedis;
  // Redis errors are handled at the request boundary. Keep connection errors
  // out of the default process logger because ioredis may include command
  // arguments (including secret IDs) in an error object.
  redis.on('error', () => {});

  redis.defineCommand('rateLimit', {
    numberOfKeys: 1,
    lua: RATE_LIMIT_SCRIPT
  });
  redis.defineCommand('storeSecret', {
    numberOfKeys: 1,
    lua: STORE_SECRET_SCRIPT
  });
  redis.defineCommand('revealSecret', {
    numberOfKeys: 1,
    lua: REVEAL_SECRET_SCRIPT
  });
  redis.defineCommand('burnSecret', {
    numberOfKeys: 1,
    lua: BURN_SECRET_SCRIPT
  });

  app.addHook('onRequest', async (request, reply) => {
    setSecurityHeaders(reply, appConfig.isProduction, appConfig.hstsMaxAgeSeconds);

    const requestPath = request.url.split('?', 1)[0];
    if (requestPath === '/api/secrets' || requestPath.startsWith('/api/secrets/')) {
      reply.header('Cache-Control', 'no-store');
      const contentType = request.headers['content-type'];
      // Defense in depth for Fastify versions affected by a leading-space
      // Content-Type validation bypass.
      if (typeof contentType === 'string' && /^\s/.test(contentType)) {
        return reply.status(400).send({
          code: 'INVALID_REQUEST',
          error: 'Invalid request.'
        });
      }
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url || 'unknown';
    request.log.info({ route, statusCode: reply.statusCode }, 'request completed');
  });

  app.setErrorHandler((error, request, reply) => {
    const isSecretApi = request.url.startsWith('/api/secrets');
    if (!isSecretApi) return reply.send(error);

    const fastifyError = error as { validation?: unknown; code?: string };

    if (fastifyError.validation) {
      return reply.status(400).send({
        code: 'INVALID_REQUEST',
        error: 'Invalid request.'
      });
    }

    if (fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send({
        code: 'PAYLOAD_TOO_LARGE',
        error: 'Request payload is too large.'
      });
    }

    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      error: 'The service could not complete this request.'
    });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/secrets')) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        error: 'Not found.'
      });
    }
    return reply.status(404).send({
      error: 'Not found.'
    });
  });

  app.register(cors, {
    origin: appConfig.corsOrigins.length === 1 ? appConfig.corsOrigins[0] : appConfig.corsOrigins
  });

  app.get('/', async () => {
    return {
      status: 'active',
      app: 'BlindDrop API',
      version: '1.0.0',
      docs: 'https://github.com/atas-tech/blinddrop'
    };
  });

  async function validateTurnstile(token: string, ip: string): Promise<boolean> {
    if (appConfig.allowTurnstileBypass && token === 'bypass') return true;
    if (!token || !appConfig.turnstileSecretKey) return false;

    const formData = new URLSearchParams();
    formData.append('secret', appConfig.turnstileSecretKey);
    formData.append('response', token);
    formData.append('remoteip', ip);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        body: formData,
        method: 'POST',
        signal: controller.signal
      });
      if (!result.ok) return false;

      const outcome = await result.json() as {
        success?: boolean;
        hostname?: string;
        action?: string;
      };

      if (!outcome.success) return false;

      const hostname = outcome.hostname?.toLowerCase();
      if (!hostname || !appConfig.turnstileAllowedHostnames.some(
        allowed => allowed.toLowerCase() === hostname
      )) {
        return false;
      }

      return !appConfig.turnstileAction || outcome.action === appConfig.turnstileAction;
    } catch {
      // Provider failures deny creation and are deliberately not logged with
      // the token, request body, or resolved secret URL.
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  const turnstileVerifier = options.turnstileVerifier ?? validateTurnstile;

  async function enforceRateLimit(
    request: FastifyRequest,
    reply: FastifyReply,
    bucket: RateLimitBucket
  ): Promise<boolean> {
    const configuredLimit = appConfig[RATE_LIMIT_BUCKET_CONFIG[bucket]] as number;
    const identity = request.ip || 'unknown';
    const identityDigest = sha256(identity);
    const key = `blinddrop:ratelimit:${bucket}:${identityDigest}`;

    try {
      const result = await redis.rateLimit(key, String(appConfig.rateLimitTimeWindow));
      if (!Array.isArray(result) || result.length < 2) {
        stateUnknown(reply);
        return false;
      }

      const count = Number(result[0]);
      const ttlMilliseconds = Number(result[1]);
      if (!Number.isFinite(count) || !Number.isFinite(ttlMilliseconds)) {
        stateUnknown(reply);
        return false;
      }

      if (count > configuredLimit) {
        const retryAfter = Math.max(1, Math.ceil(
          (ttlMilliseconds > 0 ? ttlMilliseconds : appConfig.rateLimitTimeWindow) / 1000
        ));
        reply.header('Retry-After', String(retryAfter));
        reply.status(429).send({
          code: 'RATE_LIMITED',
          error: 'Too many requests. Please try again later.'
        });
        return false;
      }

      return true;
    } catch {
      // A limiter failure must fail closed. Continuing would turn a Redis
      // outage into an unlimited creation endpoint.
      unavailable(reply);
      return false;
    }
  }

  const rateLimitPreHandler = (bucket: RateLimitBucket) => async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    if (!await enforceRateLimit(request, reply, bucket)) return reply;
  };

  const validateSecretIdPreHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const { id } = request.params as { id?: unknown };
    if (!isSecretId(id)) return notFound(reply);
  };

  app.post('/api/secrets', {
    schema: { body: CREATE_BODY_SCHEMA },
    preHandler: rateLimitPreHandler('create')
  }, async (request, reply) => {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', error: 'Invalid request.' });
    }
    const body = request.body as {
      version: number;
      ciphertext: string;
      ttl: number;
      turnstileToken: string;
      passphrase_salt?: string;
    };

    const salt = body.passphrase_salt ?? '';
    if (
      body.version !== ENVELOPE_VERSION ||
      !validCiphertext(body.ciphertext, appConfig.maxCiphertextBytes) ||
      (salt !== '' && !validSalt(salt))
    ) {
      return reply.status(400).send({
        code: 'INVALID_PAYLOAD',
        error: 'Invalid encrypted payload.'
      });
    }

    const isValidTurnstile = await turnstileVerifier(body.turnstileToken, request.ip);
    if (!isValidTurnstile) {
      return reply.status(403).send({
        code: 'INVALID_CAPTCHA',
        error: 'Invalid captcha.'
      });
    }

    const id = randomUUID();
    const burnToken = randomUUID();
    const key = `secret:${id}`;
    const burnHash = sha256(burnToken);

    try {
      const stored = await redis.storeSecret(
        key,
        String(ENVELOPE_VERSION),
        body.ciphertext,
        burnHash,
        salt,
        String(body.ttl)
      );
      if (stored !== 'stored') throw new Error('Unexpected storage result.');
    } catch {
      // No share link is returned if Redis cannot confirm the complete write.
      return reply.status(503).send({
        code: 'STORAGE_UNAVAILABLE',
        error: 'The service could not safely store this secret. No share link was created.'
      });
    }

    return { id, burnToken };
  });

  app.get('/api/secrets/:id/meta', {
    schema: { params: UUID_PARAMS_SCHEMA },
    preHandler: [validateSecretIdPreHandler, rateLimitPreHandler('meta')]
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isSecretId(id)) return notFound(reply);

    const key = `secret:${id}`;
    try {
      const status = await redis.get(`${key}:status`);
      if (TOMBSTONE_STATUSES.has(status || '')) return terminal(reply, status);

      const recordType = await redis.type(key);
      if (recordType === 'hash') {
        const [version, salt] = await Promise.all([
          redis.hget(key, 'v'),
          redis.hget(key, 'salt')
        ]);
        if (version !== String(ENVELOPE_VERSION)) return notFound(reply);
        return { status: 'active', requires_passphrase: salt !== null };
      }

      return terminal(reply, status);
    } catch {
      return unavailable(reply);
    }
  });

  app.post('/api/secrets/:id/reveal', {
    schema: { params: UUID_PARAMS_SCHEMA, body: EMPTY_BODY_SCHEMA },
    preHandler: [validateSecretIdPreHandler, rateLimitPreHandler('reveal')]
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isSecretId(id)) return notFound(reply);

    const key = `secret:${id}`;
    let result: Array<string>;
    try {
      result = await redis.revealSecret(
        key,
        String(appConfig.statusTtlSeconds),
        String(ENVELOPE_VERSION)
      );
    } catch {
      return stateUnknown(reply);
    }

    if (!Array.isArray(result) || result.length === 0) return stateUnknown(reply);

    const kind = result[0];
    if (kind === 'hash') {
      const ciphertext = result[2];
      const version = Number(result[1]);
      const salt = result[3] || '';
      if (
        version !== ENVELOPE_VERSION ||
        !validCiphertext(ciphertext, appConfig.maxCiphertextBytes) ||
        (salt !== '' && !validSalt(salt))
      ) return stateUnknown(reply);

      const payload: { version: number; ciphertext: string; salt?: string } = {
        version,
        ciphertext
      };
      if (salt) payload.salt = salt;
      return payload;
    }

    if (kind === 'viewed' || kind === 'burned') {
      return terminal(reply, kind);
    }

    if (kind === 'invalid' || kind === 'missing') return notFound(reply);
    return stateUnknown(reply);
  });

  app.post('/api/secrets/:id/burn', {
    schema: {
      params: UUID_PARAMS_SCHEMA,
      body: BURN_BODY_SCHEMA
    },
    preHandler: [validateSecretIdPreHandler, rateLimitPreHandler('burn')]
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isSecretId(id)) return notFound(reply);

    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', error: 'Invalid request.' });
    }
    const { burnToken } = request.body as { burnToken: string };
    const key = `secret:${id}`;
    let result: Array<string>;
    try {
      result = await redis.burnSecret(
        key,
        sha256(burnToken),
        String(appConfig.statusTtlSeconds),
        String(ENVELOPE_VERSION)
      );
    } catch {
      return stateUnknown(reply);
    }

    if (!Array.isArray(result) || result.length === 0) return stateUnknown(reply);

    switch (result[0]) {
      case 'burned':
        return { success: true };
      case 'forbidden':
        return reply.status(403).send({
          code: 'INVALID_BURN_TOKEN',
          error: 'Invalid burn token.'
        });
      case 'gone':
        return terminal(reply, result[1]);
      case 'missing':
        return notFound(reply);
      case 'invalid':
        return notFound(reply);
      default:
        return stateUnknown(reply);
    }
  });

  app.addHook('onClose', async () => {
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  });

  return app;
}
