import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { buildApp } from '../../server/app.js';

export const VALID_TTL = 3600;
const VALID_ENVELOPE = Buffer.alloc(29, 7);
VALID_ENVELOPE[0] = 2;
export const VALID_CIPHERTEXT = VALID_ENVELOPE.toString('base64');
export const VALID_SALT = Buffer.alloc(16, 3).toString('base64');

export function ciphertextOfBytes(length: number): string {
  const envelope = Buffer.alloc(length, 7);
  if (length > 0) envelope[0] = 2;
  return envelope.toString('base64');
}

export function createTestApp(redisUrl: string, overrides: Record<string, unknown> = {}): FastifyInstance {
  return buildApp({
    redisUrl,
    config: {
      isProduction: false,
      allowTurnstileBypass: false,
      corsOrigin: 'http://localhost:3000',
      corsOrigins: ['http://localhost:3000'],
      turnstileSecretKey: '',
      turnstileAllowedHostnames: [],
      trustedProxyIps: [],
      ...overrides
    },
    turnstileVerifier: async token => token === 'valid-test-token'
  });
}

export async function createSecret(
  app: FastifyInstance,
  options: { passphrase?: boolean; ciphertext?: string; ttl?: number } = {}
): Promise<{ id: string; burnToken: string; key: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/secrets',
    payload: {
      version: 2,
      ciphertext: options.ciphertext ?? VALID_CIPHERTEXT,
      ttl: options.ttl ?? VALID_TTL,
      turnstileToken: 'valid-test-token',
      ...(options.passphrase ? { passphrase_salt: VALID_SALT } : {})
    }
  });

  if (response.statusCode !== 200) {
    throw new Error(`Test secret creation failed: ${response.statusCode} ${response.body}`);
  }
  const body = response.json() as { id: string; burnToken: string };
  return { ...body, key: `secret:${body.id}` };
}

export async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, page] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
    cursor = nextCursor;
    keys.push(...page);
  } while (cursor !== '0');
  return keys;
}
