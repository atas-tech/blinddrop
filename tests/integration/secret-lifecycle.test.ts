import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { createSecret, createTestApp, scanKeys, VALID_CIPHERTEXT } from '../helpers/app.js';
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

test('concurrent_reveals_deliver_ciphertext_at_most_once', async () => {
  const secret = await createSecret(app);
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => app.inject({
      method: 'POST',
      url: `/api/secrets/${secret.id}/reveal`
    }))
  );

  assert.equal(responses.filter(response => response.statusCode === 200).length, 1);
  assert.equal(responses.filter(response => response.statusCode === 410).length, 9);
  assert.equal(responses.find(response => response.statusCode === 200)?.json().ciphertext, VALID_CIPHERTEXT);
});

test('reveal_vs_burn_has_one_atomic_winner', async () => {
  const secret = await createSecret(app);
  const [reveal, burn] = await Promise.all([
    app.inject({ method: 'POST', url: `/api/secrets/${secret.id}/reveal` }),
    app.inject({
      method: 'POST',
      url: `/api/secrets/${secret.id}/burn`,
      payload: { burnToken: secret.burnToken }
    })
  ]);

  assert.ok(
    (reveal.statusCode === 200 && burn.statusCode === 410) ||
    (reveal.statusCode === 410 && burn.statusCode === 200)
  );
  const keys = await scanKeys(redis, `${secret.key}*`);
  assert.deepEqual(keys.sort(), [`${secret.key}:status`]);
});

test('unauthorized_burn_cannot_change_live_state', async () => {
  const secret = await createSecret(app, { passphrase: true });
  const wrongToken = '00000000-0000-4000-8000-000000000000';
  const response = await app.inject({
    method: 'POST',
    url: `/api/secrets/${secret.id}/burn`,
    payload: { burnToken: wrongToken }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(await redis.type(secret.key), 'hash');
  assert.notEqual(await redis.hget(secret.key, 'burn_hash'), wrongToken);
  assert.equal(await redis.get(`${secret.key}:status`), null);

  const reveal = await app.inject({ method: 'POST', url: `/api/secrets/${secret.id}/reveal` });
  assert.equal(reveal.statusCode, 200);
});

test('terminal_operations_leave_only_the_tombstone', async () => {
  const revealed = await createSecret(app, { passphrase: true });
  const revealResponse = await app.inject({ method: 'POST', url: `/api/secrets/${revealed.id}/reveal` });
  assert.equal(revealResponse.statusCode, 200);
  assert.deepEqual(await scanKeys(redis, `${revealed.key}*`), [`${revealed.key}:status`]);

  const burned = await createSecret(app, { passphrase: true });
  const burnResponse = await app.inject({
    method: 'POST',
    url: `/api/secrets/${burned.id}/burn`,
    payload: { burnToken: burned.burnToken }
  });
  assert.equal(burnResponse.statusCode, 200);
  assert.deepEqual(await scanKeys(redis, `${burned.key}*`), [`${burned.key}:status`]);
});

test('get_head_and_metadata_do_not_deliver_or_consume', async () => {
  const secret = await createSecret(app);
  const meta = await app.inject({ method: 'GET', url: `/api/secrets/${secret.id}/meta` });
  const headMeta = await app.inject({ method: 'HEAD', url: `/api/secrets/${secret.id}/meta` });
  const retiredGet = await app.inject({ method: 'GET', url: `/api/secrets/${secret.id}` });
  const retiredHead = await app.inject({ method: 'HEAD', url: `/api/secrets/${secret.id}` });

  assert.equal(meta.statusCode, 200);
  assert.equal(headMeta.statusCode, 200);
  assert.equal(retiredGet.statusCode, 404);
  assert.equal(retiredHead.statusCode, 404);
  assert.equal(await redis.type(secret.key), 'hash');
  assert.equal(await redis.get(`${secret.key}:status`), null);

  const reveal = await app.inject({ method: 'POST', url: `/api/secrets/${secret.id}/reveal` });
  assert.equal(reveal.statusCode, 200);
});

test('deprecated_retrieval_routes_are_removed', async () => {
  const secret = await createSecret(app);
  const requests = [
    app.inject({ method: 'GET', url: `/api/secrets/${secret.id}` }),
    app.inject({ method: 'HEAD', url: `/api/secrets/${secret.id}` }),
    app.inject({ method: 'POST', url: `/api/secrets/${secret.id}/access` }),
    app.inject({ method: 'POST', url: `/api/secrets/${secret.id}/consume` })
  ];
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map(response => response.statusCode), [404, 404, 404, 404]);
  assert.equal(responses[0].json().code, 'NOT_FOUND');
  assert.equal(await redis.type(secret.key), 'hash');
  assert.equal(await redis.get(`${secret.key}:status`), null);
});

test('pre_v2_string_records_are_not_delivered_or_converted', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const key = `secret:${id}`;
  await redis.set(key, 'legacy-ciphertext');
  await redis.expire(key, 60);

  try {
    const [meta, reveal, burn] = await Promise.all([
      app.inject({ method: 'GET', url: `/api/secrets/${id}/meta` }),
      app.inject({ method: 'POST', url: `/api/secrets/${id}/reveal` }),
      app.inject({
        method: 'POST',
        url: `/api/secrets/${id}/burn`,
        payload: { burnToken: '00000000-0000-4000-8000-000000000002' }
      })
    ]);

    assert.deepEqual([meta.statusCode, reveal.statusCode, burn.statusCode], [404, 404, 404]);
    assert.equal(await redis.type(key), 'string');
    assert.equal(await redis.get(key), 'legacy-ciphertext');
  } finally {
    await redis.del(key);
  }
});

test('pre_v2_hash_records_are_not_delivered_or_burned', async () => {
  const id = '00000000-0000-4000-8000-000000000003';
  const key = `secret:${id}`;
  await redis.hset(key, 'v', '1', 'ciphertext', VALID_CIPHERTEXT, 'burn_hash', 'legacy-hash');
  await redis.expire(key, 60);

  try {
    const [meta, reveal, burn] = await Promise.all([
      app.inject({ method: 'GET', url: `/api/secrets/${id}/meta` }),
      app.inject({ method: 'POST', url: `/api/secrets/${id}/reveal` }),
      app.inject({
        method: 'POST',
        url: `/api/secrets/${id}/burn`,
        payload: { burnToken: '00000000-0000-4000-8000-000000000004' }
      })
    ]);

    assert.deepEqual([meta.statusCode, reveal.statusCode, burn.statusCode], [404, 404, 404]);
    assert.equal(await redis.type(key), 'hash');
    assert.equal(await redis.hget(key, 'v'), '1');
    assert.equal(await redis.get(`${key}:status`), null);
  } finally {
    await redis.del(key);
  }
});
