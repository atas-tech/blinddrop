import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { ciphertextOfBytes, createSecret, createTestApp, VALID_CIPHERTEXT, VALID_TTL } from '../helpers/app.js';
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

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    ciphertext: VALID_CIPHERTEXT,
    ttl: VALID_TTL,
    turnstileToken: 'valid-test-token',
    ...overrides
  };
}

test('malformed_null_or_unknown_body_fields_return_controlled_errors', async () => {
  const unknown = await app.inject({
    method: 'POST',
    url: '/api/secrets',
    payload: createPayload({ unexpected: 'value' })
  });
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.json().code, 'INVALID_REQUEST');

  const nullBody = await app.inject({
    method: 'POST',
    url: '/api/secrets',
    headers: { 'content-type': 'application/json' },
    payload: 'null'
  });
  assert.equal(nullBody.statusCode, 400);
  assert.equal(nullBody.json().code, 'INVALID_REQUEST');
});

test('unsupported_ttl_and_invalid_ciphertext_or_salt_are_rejected', async () => {
  const preV2Envelope = Buffer.alloc(29, 7);
  preV2Envelope[0] = 1;
  for (const payload of [
    createPayload({ version: 1 }),
    createPayload({ ciphertext: preV2Envelope.toString('base64') }),
    createPayload({ ttl: 301 }),
    createPayload({ ciphertext: 'not-base64' }),
    createPayload({ passphrase_salt: Buffer.alloc(15, 1).toString('base64') }),
    createPayload({ passphrase_salt: 'A'.repeat(24) })
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/secrets', payload });
    assert.equal(response.statusCode, 400);
  }
});

test('utf8_encoded_payload_limit_accepts_100_kib_and_rejects_one_byte_more', async () => {
  const maximum = await app.inject({
    method: 'POST',
    url: '/api/secrets',
    payload: createPayload({ ciphertext: ciphertextOfBytes(1 + 12 + 16 + 100 * 1024) })
  });
  assert.equal(maximum.statusCode, 200);

  const tooLarge = await app.inject({
    method: 'POST',
    url: '/api/secrets',
    payload: createPayload({ ciphertext: ciphertextOfBytes(1 + 12 + 16 + 100 * 1024 + 1) })
  });
  assert.equal(tooLarge.statusCode, 400);
});

test('every_secret_response_including_errors_has_no_store', async () => {
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/secrets',
    payload: createPayload({ ttl: 1 })
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.headers['cache-control'], 'no-store');

  const secret = await createSecret(app);
  const meta = await app.inject({ method: 'GET', url: `/api/secrets/${secret.id}/meta` });
  const old = await app.inject({ method: 'GET', url: `/api/secrets/${secret.id}` });
  const reveal = await app.inject({ method: 'POST', url: `/api/secrets/${secret.id}/reveal` });

  for (const response of [meta, old, reveal]) {
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('api_security_headers_match_the_origin_policy', async () => {
  const response = await app.inject({ method: 'GET', url: '/' });
  assert.equal(response.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
});
