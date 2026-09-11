import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { createSecret, createTestApp, scanKeys, VALID_CIPHERTEXT, VALID_SALT } from '../helpers/app.js';
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

test('invalid_secret_ids_are_rejected_on_every_route', async () => {
  const invalidIds = ['not-a-uuid', `${randomUUID()}:salt`];
  for (const invalidId of invalidIds) {
    const encodedId = encodeURIComponent(invalidId);
    const requests = [
      app.inject({ method: 'GET', url: `/api/secrets/${encodedId}/meta` }),
      app.inject({ method: 'HEAD', url: `/api/secrets/${encodedId}/meta` }),
      app.inject({ method: 'POST', url: `/api/secrets/${encodedId}/reveal` }),
      app.inject({ method: 'GET', url: `/api/secrets/${encodedId}` }),
      app.inject({ method: 'HEAD', url: `/api/secrets/${encodedId}` }),
      app.inject({ method: 'POST', url: `/api/secrets/${encodedId}/access` }),
      app.inject({ method: 'POST', url: `/api/secrets/${encodedId}/consume` }),
      app.inject({
        method: 'POST',
        url: `/api/secrets/${encodedId}/burn`,
        payload: { burnToken: randomUUID() }
      })
    ];
    const responses = await Promise.all(requests);
    assert.deepEqual(responses.map(response => response.statusCode), [404, 404, 404, 404, 404, 404, 404, 404]);
  }
});

test('deprecated_auxiliary_paths_are_not_registered', async () => {
  const secret = await createSecret(app, { passphrase: true });
  const before = await scanKeys(redis, `${secret.key}*`);

  for (const suffix of [':salt', ':burn', ':lock', ':status']) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/secrets/${encodeURIComponent(secret.id + suffix)}`
    });
    assert.equal(response.statusCode, 404);
  }

  for (const request of [
    { method: 'GET' as const, url: `/api/secrets/${secret.id}` },
    { method: 'HEAD' as const, url: `/api/secrets/${secret.id}` },
    { method: 'POST' as const, url: `/api/secrets/${secret.id}/access` },
    { method: 'POST' as const, url: `/api/secrets/${secret.id}/consume` }
  ]) {
    assert.equal((await app.inject(request)).statusCode, 404);
  }

  assert.deepEqual(await scanKeys(redis, `${secret.key}*`), before);
});

test('valid_uuid_routes_remain_usable', async () => {
  const secret = await createSecret(app, { passphrase: true });
  const meta = await app.inject({ method: 'GET', url: `/api/secrets/${secret.id}/meta` });
  assert.equal(meta.statusCode, 200);
  assert.deepEqual(meta.json(), { status: 'active', requires_passphrase: true });

  const reveal = await app.inject({ method: 'POST', url: `/api/secrets/${secret.id}/reveal` });
  assert.equal(reveal.statusCode, 200);
  assert.deepEqual(reveal.json(), {
    version: 2,
    ciphertext: VALID_CIPHERTEXT,
    salt: VALID_SALT
  });
});
