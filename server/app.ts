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
    origin: '*' // Simplify for MVP, configure appropriately for prod
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
    const { ciphertext, ttl, turnstileToken } = request.body as any;

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
