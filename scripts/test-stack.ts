import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { startRedis, type RedisHandle } from '../tests/helpers/redis.js';

async function waitForHttp(port: number): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const request = http.get({ host: '127.0.0.1', port, path: '/' }, response => {
          response.resume();
          response.once('end', resolve);
        });
        request.once('error', reject);
        request.setTimeout(1000, () => {
          request.destroy();
          reject(new Error('HTTP readiness request timed out.'));
        });
      });
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for HTTP service on port ${port}.`);
}

function stopProcess(child: ChildProcess): void {
  if (child.exitCode === null) child.kill('SIGTERM');
}

async function main(): Promise<void> {
  const children: ChildProcess[] = [];
  let redisHandle: RedisHandle | undefined;
  let shuttingDown = false;

  const stopAll = async () => {
    for (const child of children) stopProcess(child);
    await redisHandle?.stop();
  };

  const cleanup = async (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await stopAll();
    process.exit(code);
  };

  process.on('SIGINT', () => { void cleanup(0); });
  process.on('SIGTERM', () => { void cleanup(0); });

  try {
    redisHandle = await startRedis();
    const api = spawn(process.execPath, ['dist-server/index.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '3001',
        REDIS_URL: redisHandle.url,
        CORS_ORIGIN: 'http://127.0.0.1:3000',
        ALLOW_TURNSTILE_BYPASS: '1'
      },
      stdio: 'inherit'
    });
    const frontend = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
      env: {
        ...process.env,
        VITE_ALLOW_INSECURE_API: '1',
        VITE_ALLOW_TURNSTILE_BYPASS: '1'
      },
      stdio: 'inherit'
    });
    children.push(api, frontend);

    await Promise.all([waitForHttp(3001), waitForHttp(3000)]);

    api.once('exit', code => {
      if (!shuttingDown && code !== 0) void cleanup(code || 1);
    });
    frontend.once('exit', code => {
      if (!shuttingDown && code !== 0) void cleanup(code || 1);
    });
  } catch (error) {
    await stopAll();
    throw error;
  }

  await new Promise<void>(() => {});
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Test stack failed.');
  process.exitCode = 1;
});
