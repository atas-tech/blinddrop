import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { assertProductionConfig, loadConfig } from '../../server/config.js';
import { buildApp } from '../../server/app.js';
import { createSecret, createTestApp, VALID_CIPHERTEXT, VALID_TTL } from '../helpers/app.js';
import { startRedis, type RedisHandle } from '../helpers/redis.js';

let redisHandle: RedisHandle;
let redis: Redis;
let app: FastifyInstance;

before(async () => {
  redisHandle = await startRedis();
  redis = new Redis(redisHandle.url);
  await redis.flushall();
  app = createTestApp(redisHandle.url);
  await app.ready();
});

after(async () => {
  await app?.close();
  await redis?.quit();
  await redisHandle?.stop();
});

function createPayload() {
  return {
    version: 2,
    ciphertext: VALID_CIPHERTEXT,
    ttl: VALID_TTL,
    turnstileToken: 'valid-test-token'
  };
}

test('production_rejects_missing_or_test_turnstile_secret', () => {
  const common = {
    ...process.env,
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://blinddrop.atas.tech',
    TURNSTILE_ALLOWED_HOSTNAMES: 'blinddrop.atas.tech'
  };

  assert.throws(
    () => assertProductionConfig(loadConfig({ ...common, TURNSTILE_SECRET_KEY: '' })),
    /TURNSTILE_SECRET_KEY/
  );
  assert.throws(
    () => assertProductionConfig(loadConfig({
      ...common,
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA'
    })),
    /TURNSTILE_SECRET_KEY/
  );
  assert.throws(
    () => assertProductionConfig(loadConfig({
      ...common,
      TURNSTILE_SECRET_KEY: 'real-secret',
      CORS_ORIGIN: '*'
    })),
    /CORS_ORIGIN/
  );
  assert.doesNotThrow(() => assertProductionConfig(loadConfig({
    ...common,
    TURNSTILE_SECRET_KEY: 'real-secret'
  })));
});

test('production_frontend_requires_turnstile_site_key', () => {
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_API_URL: 'https://blinddrop-api.atas.tech',
      VITE_TURNSTILE_SITE_KEY: '',
      VITE_ALLOW_INSECURE_API: '',
      VITE_ALLOW_TURNSTILE_BYPASS: ''
    },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /VITE_TURNSTILE_SITE_KEY/);
});

test('unexpected_turnstile_hostname_or_action_is_rejected', async () => {
  await redis.flushall();
  const originalFetch = globalThis.fetch;
  const productionApp = buildApp({
    redisUrl: redisHandle.url,
    config: {
      isProduction: true,
      allowTurnstileBypass: false,
      corsOrigin: 'https://blinddrop.atas.tech',
      corsOrigins: ['https://blinddrop.atas.tech'],
      turnstileSecretKey: 'real-secret',
      turnstileAllowedHostnames: ['blinddrop.atas.tech'],
      turnstileAction: 'create-secret'
    }
  });
  await productionApp.ready();

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      success: true,
      hostname: 'evil.example',
      action: 'create-secret'
    }), { status: 200 });
    const wrongHost = await productionApp.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { ...createPayload(), turnstileToken: 'provider-token' }
    });
    assert.equal(wrongHost.statusCode, 403);

    globalThis.fetch = async () => new Response(JSON.stringify({
      success: true,
      hostname: 'blinddrop.atas.tech',
      action: 'different-action'
    }), { status: 200 });
    const wrongAction = await productionApp.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { ...createPayload(), turnstileToken: 'provider-token' }
    });
    assert.equal(wrongAction.statusCode, 403);
  } finally {
    globalThis.fetch = originalFetch;
    await productionApp.close();
  }
});

test('invalid_or_timed_out_turnstile_verification_rejects_creation', async () => {
  await redis.flushall();
  const invalidApp = createTestApp(redisHandle.url, { createRateLimitMax: 10 });
  await invalidApp.ready();
  const response = await invalidApp.inject({
    method: 'POST',
    url: '/api/secrets',
    payload: { ...createPayload(), turnstileToken: 'invalid-token' }
  });
  assert.equal(response.statusCode, 403);
  await invalidApp.close();
});

test('creation_limit_returns_429_before_excess_verification_work', async () => {
  await redis.flushall();
  let verificationCount = 0;
  const limitedApp = buildApp({
    redisUrl: redisHandle.url,
    config: {
      isProduction: false,
      allowTurnstileBypass: false,
      corsOrigin: 'http://localhost:3000',
      corsOrigins: ['http://localhost:3000'],
      createRateLimitMax: 1,
      rateLimitTimeWindow: 60000
    },
    turnstileVerifier: async () => {
      verificationCount += 1;
      return true;
    }
  });
  await limitedApp.ready();

  const first = await limitedApp.inject({ method: 'POST', url: '/api/secrets', payload: createPayload() });
  const second = await limitedApp.inject({ method: 'POST', url: '/api/secrets', payload: createPayload() });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(verificationCount, 1);
  await limitedApp.close();
});

test('rate_limit_is_shared_across_api_instances', async () => {
  await redis.flushall();
  const appOne = createTestApp(redisHandle.url, { createRateLimitMax: 2, rateLimitTimeWindow: 60000 });
  const appTwo = createTestApp(redisHandle.url, { createRateLimitMax: 2, rateLimitTimeWindow: 60000 });
  await Promise.all([appOne.ready(), appTwo.ready()]);

  const responses = await Promise.all([
    appOne.inject({ method: 'POST', url: '/api/secrets', payload: createPayload() }),
    appTwo.inject({ method: 'POST', url: '/api/secrets', payload: createPayload() }),
    appOne.inject({ method: 'POST', url: '/api/secrets', payload: createPayload() })
  ]);
  assert.equal(responses.filter(response => response.statusCode === 200).length, 2);
  assert.equal(responses.filter(response => response.statusCode === 429).length, 1);
  await Promise.all([appOne.close(), appTwo.close()]);
});

test('spoofed_forwarded_ip_does_not_bypass_limits', async () => {
  await redis.flushall();
  const limitedApp = createTestApp(redisHandle.url, { createRateLimitMax: 1, rateLimitTimeWindow: 60000 });
  await limitedApp.ready();
  const first = await limitedApp.inject({
    method: 'POST',
    url: '/api/secrets',
    headers: { 'x-forwarded-for': '198.51.100.1' },
    payload: createPayload()
  });
  const second = await limitedApp.inject({
    method: 'POST',
    url: '/api/secrets',
    headers: { 'x-forwarded-for': '198.51.100.2' },
    payload: createPayload()
  });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  await limitedApp.close();
});

test('limiter_failure_does_not_silently_allow_unlimited_creation', async () => {
  const unavailableApp = createTestApp('redis://127.0.0.1:1');
  await unavailableApp.ready();
  const response = await unavailableApp.inject({
    method: 'POST',
    url: '/api/secrets',
    payload: createPayload()
  });
  assert.equal(response.statusCode, 503);
  assert.match(response.json().code, /SERVICE_UNAVAILABLE|SECRET_STATE_UNKNOWN/);
  await unavailableApp.close();
});
