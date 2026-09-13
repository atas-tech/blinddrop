import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';

export interface RedisHandle {
  url: string;
  stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local test port.'));
        return;
      }
      const port = address.port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function commandExists(command: string, args: string[]): Promise<boolean> {
  return await new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', code => resolve(code === 0));
  });
}

async function waitForPort(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10000;
  let processError: Error | undefined;
  const onProcessError = (error: Error) => { processError = error; };
  child.once('error', onProcessError);
  while (Date.now() < deadline) {
    if (processError) throw processError;
    if (child.exitCode !== null) throw new Error('redis-server exited before becoming ready.');
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('error', reject);
      });
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  child.off('error', onProcessError);
  throw new Error('Timed out waiting for redis-server. Install Redis or set TEST_REDIS_URL.');
}

export async function startRedis(): Promise<RedisHandle> {
  if (process.env.TEST_REDIS_URL) {
    return {
      url: process.env.TEST_REDIS_URL,
      stop: async () => {}
    };
  }

  const port = await freePort();
  const useRedisBinary = await commandExists('redis-server', ['--version']);
  const useDocker = !useRedisBinary && await commandExists('docker', ['info']);
  const redisArgs = [
    // A bridged Docker container must listen on its container interface;
    // native Redis can stay bound to loopback on the host.
    '--bind', useRedisBinary ? '127.0.0.1' : '0.0.0.0',
    // Docker maps host port N to Redis' container port 6379. A native
    // redis-server uses the allocated host port directly.
    '--port', useRedisBinary ? String(port) : '6379',
    '--save', '',
    '--appendonly', 'no',
    '--maxmemory-policy', 'noeviction'
  ];
  if (!useRedisBinary && !useDocker) {
    throw new Error('Neither redis-server nor Docker is available. Set TEST_REDIS_URL to an isolated Redis instance.');
  }
  const dockerName = `blinddrop-test-redis-${process.pid}-${port}`;
  const child = useRedisBinary
    ? spawn('redis-server', redisArgs, { stdio: 'ignore' })
    : spawn('docker', [
      'run', '--rm', '--name', dockerName,
      '--publish', `127.0.0.1:${port}:6379`,
      'redis:7-alpine',
      'redis-server', ...redisArgs
    ], { stdio: 'ignore' });

  try {
    await waitForPort(port, child);
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(
      `${error instanceof Error ? error.message : 'Could not start Redis.'} ` +
      'Install redis-server, allow Docker for tests, or set TEST_REDIS_URL.'
    );
  }

  return {
    url: `redis://127.0.0.1:${port}`,
    stop: async () => {
      if (!useRedisBinary) {
        // Removing the container first also handles runners that terminate
        // this docker CLI process without propagating the signal to Redis.
        try {
          spawnSync('docker', ['rm', '-f', dockerName], {
            stdio: 'ignore',
            timeout: 5000
          });
        } catch {
          // Cleanup is best effort when Docker itself is unavailable.
        }
      }

      if (child.exitCode === null) child.kill('SIGTERM');
      if (child.exitCode === null) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 2000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    }
  };
}
