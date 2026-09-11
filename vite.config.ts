import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

const TEST_TURNSTILE_SITE_KEYS = new Set([
  '1x00000000000000000000AA',
  '1x0000000000000000000000000000000AA'
]);

function isSecureApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const allowInsecureApi = env.VITE_ALLOW_INSECURE_API === '1';
  const allowLocalTurnstileBypass = allowInsecureApi && env.VITE_ALLOW_TURNSTILE_BYPASS === '1';

  if (command === 'build' && !allowInsecureApi) {
    if (!env.VITE_API_URL || !isSecureApiUrl(env.VITE_API_URL)) {
      throw new Error('VITE_API_URL must be an https:// URL for production builds. Set VITE_ALLOW_INSECURE_API=1 only for local development.');
    }
  }

  if (command === 'build' && !allowLocalTurnstileBypass) {
    if (!env.VITE_TURNSTILE_SITE_KEY || TEST_TURNSTILE_SITE_KEYS.has(env.VITE_TURNSTILE_SITE_KEY)) {
      throw new Error('VITE_TURNSTILE_SITE_KEY must be set to a real Turnstile site key for production builds.');
    }
  }

  return {
    plugins: [tailwindcss()],
    base: './',
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          privacy: resolve(__dirname, 'privacy.html'),
        },
      },
    }
  };
});
