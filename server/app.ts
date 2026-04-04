import fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { Redis } from 'ioredis';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function buildApp() {
  const app = fastify({
    logger: true,
    bodyLimit: config.maxPayloadSize
  });

  const redis = new Redis(config.redisUrl);

  const LUA_RETRIEVE_SCRIPT = `
    local secret = redis.call("GET", KEYS[1])
    if secret then
      redis.call("DEL", KEYS[1])
      -- Set tombstone: id:status -> 'viewed' with 1 hr expiry
      redis.call("SETEX", KEYS[1] .. ":status", 3600, "viewed")
      return secret
    end
    return nil
  `;

  // Define script on redis instance
  redis.defineCommand("retrieveAndBurn", {
    numberOfKeys: 1,
    lua: LUA_RETRIEVE_SCRIPT,
  });

  app.register(cors, {
    origin: config.corsOrigin
  });

  if (config.isProduction) {
    app.register(staticPlugin, {
      root: path.join(__dirname, '../dist'),
      prefix: '/',
    });
  }

  // Turnstile validation helper
  async function validateTurnstile(token: string, ip: string): Promise<boolean> {
    const formData = new URLSearchParams();
    formData.append('secret', config.turnstileSecretKey);
    formData.append('response', token);
    formData.append('remoteip', ip);

    try {
      const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        body: formData,
        method: 'POST',
      });
      const outcome = await result.json() as any;
      return !!outcome.success;
    } catch (err) {
      app.log.error(err, 'Turnstile validation failed');
      return false;
    }
  }

  app.post('/api/secrets', async (request, reply) => {
    const { ciphertext, ttl, turnstileToken, passphrase_salt } = request.body as any;

    if (!config.isProduction && turnstileToken === 'bypass') {
       // local tests bypass
    } else {
        const isValid = await validateTurnstile(turnstileToken, request.ip);
        if (!isValid) {
        return reply.status(403).send({ error: 'Invalid captcha' });
        }
    }

    if (!ciphertext || typeof ciphertext !== 'string') {
      return reply.status(400).send({ error: 'Invalid ciphertext' });
    }

    const validTtls = [5 * 60, 60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60];
    const expiry = validTtls.includes(ttl) ? ttl : 60 * 60; // Default to 1h

    const id = crypto.randomUUID();
    const burnToken = crypto.randomUUID();

    // Store in Redis
    await redis.set(`secret:${id}`, ciphertext, 'EX', expiry);
    
    // Store burn token
    await redis.set(`secret:${id}:burn`, burnToken, 'EX', expiry);
    
    // Set active status (useful if we want to query status without viewing)
    await redis.set(`secret:${id}:status`, 'active', 'EX', expiry);

    // Save passphrase salt if present
    if (passphrase_salt && typeof passphrase_salt === 'string') {
        await redis.set(`secret:${id}:salt`, passphrase_salt, 'EX', expiry);
    }

    return { id, burnToken };
  });

  app.get('/api/secrets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const key = `secret:${id}`;

    const secret = await (redis as any).retrieveAndBurn(key);

    if (secret) {
      return { ciphertext: secret };
    }

    // Check tombstone/status
    const status = await redis.get(`${key}:status`);
    
    if (status === 'viewed') {
      return reply.status(410).send({ error: 'Secret has already been viewed and destroyed.' });
    } else if (status === 'burned') {
      return reply.status(410).send({ error: 'Secret was proactively burned by the sender.' });
    }

    // If no secret and no status, it either expired or never existed. 404 is appropriate.
    return reply.status(404).send({ error: 'Secret not found or expired.' });
  });
  
  app.get('/api/secrets/:id/meta', async (request, reply) => {
    const { id } = request.params as { id: string };
    const key = `secret:${id}`;

    const status = await redis.get(`${key}:status`);
    if (status === 'viewed') {
      return reply.status(410).send({ error: 'Secret has already been viewed and destroyed.' });
    } else if (status === 'burned') {
      return reply.status(410).send({ error: 'Secret was proactively burned by the sender.' });
    } else if (status !== 'active') {
      return reply.status(404).send({ error: 'Secret not found or expired.' });
    }

    const salt = await redis.get(`${key}:salt`);
    return {
      status,
      requires_passphrase: !!salt,
      salt: salt || undefined
    };
  });

  app.post('/api/secrets/:id/access', async (request, reply) => {
    const { id } = request.params as { id: string };
    const key = `secret:${id}`;

    const status = await redis.get(`${key}:status`);
    if (status !== 'active') {
      return reply.status(404).send({ error: 'Secret not found or unavailable.' });
    }

    const accessToken = crypto.randomUUID();
    const lockKey = `${key}:lock`;
    const lockSet = await redis.set(lockKey, accessToken, 'EX', config.reservationTtl, 'NX');
    
    if (lockSet !== 'OK') {
      return reply.status(423).send({ error: 'Secret is currently actively being viewed by someone else. Please try again shortly.' });
    }

    const ciphertext = await redis.get(key);
    if (!ciphertext) {
      return reply.status(404).send({ error: 'Secret payload missing.' });
    }

    return { ciphertext, access_token: accessToken };
  });

  app.post('/api/secrets/:id/consume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { access_token } = request.body as any;
    const key = `secret:${id}`;

    const lockKey = `${key}:lock`;
    const currentLock = await redis.get(lockKey);

    if (!currentLock || currentLock !== access_token) {
        return reply.status(403).send({ error: 'Invalid or expired access token.' });
    }

    await redis.del(key);
    await redis.del(`${key}:salt`);
    await redis.del(`${key}:burn`);
    await redis.del(lockKey);

    await redis.setex(`${key}:status`, 3600, 'viewed');

    return { success: true };
  });
  
  app.post('/api/secrets/:id/burn', async (request, reply) => {
      // In a real app, you might want an auth token to burn. 
      // For a truly blind drop without account, we can't strongly authenticate the burner
      // unless we returned a "burn token" on creation.
      // E.g. we add burnToken generated on create.
      const { id } = request.params as { id: string };
      const { burnToken } = request.body as { burnToken: string };
      
      const key = `secret:${id}`;
      const expectedToken = await redis.get(`${key}:burn`);
      
      if (!expectedToken || expectedToken !== burnToken) {
          return reply.status(403).send({ error: 'Invalid burn token' });
      }
      
      await redis.del(key);
      await redis.del(`${key}:burn`);
      
      // Set tombstone
      await redis.setex(`${key}:status`, 3600, 'burned');
      
      return { success: true };
  });

  return app;
}
