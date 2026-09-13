# BlindDrop 🛡️

**BlindDrop** is a standalone, public, one-time secret sharing service designed with a **zero-knowledge architecture**. It allows you to share sensitive information (passwords, API keys, etc.) securely, ensuring that even the server hosting the service never sees your plaintext data.

[![Frontend Deployment](https://github.com/atas-tech/blinddrop/actions/workflows/deploy-frontend.yml/badge.svg)](https://github.com/atas-tech/blinddrop/actions/workflows/deploy-frontend.yml)
[![API Build](https://github.com/atas-tech/blinddrop/actions/workflows/build-api.yml/badge.svg)](https://github.com/atas-tech/blinddrop/actions/workflows/build-api.yml)

## 🔐 Security Architecture

BlindDrop uses the **WebCrypto API** for client-side encryption:

- **Encryption**: Standard **AES-256-GCM** encryption performed entirely in your browser.
- **Key Strategy**: Every link carries a random 256-bit fragment key, which is never sent to the server. The encrypted envelope is versioned so clients never silently reinterpret another protocol.
- **Passphrase Mode**: The fragment key remains required and a passphrase adds a second factor. The browser derives `PBKDF2-SHA-256(passphrase, salt, 600000)` and combines that output with the fragment key through `HKDF-SHA-256` using the `blinddrop-v2` domain label. Use a long, unique passphrase and share it separately; anyone with the full link and a weak passphrase can still guess offline.
- **Self-Destruction**: Secrets are stored in an ephemeral Redis instance and the encrypted envelope is deleted when it is delivered once or when the selected TTL (5m to 7d) expires. A lost reveal response can therefore make the secret unrecoverable.
- **Anti-Abuse**: Protected by **Cloudflare Turnstile** to prevent automated secret creation.

## 🛠️ Technology Stack

- **Frontend**: Vanilla TypeScript + Vite + Tailwind CSS v4 (CSS-first tokens in `src/style.css`; three themes: light, dark, and a green-on-black "hacker" theme, selectable from the header and persisted in `localStorage`).
- **Backend**: Fastify (TypeScript).
- **Storage**: Redis (Ephemeral data).
- **Infrastructure**: Dockerized for easy deployment.

## 🚀 Getting Started

### Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/atas-tech/blinddrop.git
   cd blinddrop
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start local Redis** (ephemeral):
   ```bash
   docker run --rm --name blinddrop-dev-redis \
     --publish 127.0.0.1:6379:6379 \
     redis:7-alpine redis-server --save "" --appendonly no
   ```

4. **Run the API with the explicit local-only captcha bypass**:
   ```bash
   NODE_ENV=development ALLOW_TURNSTILE_BYPASS=1 \
     REDIS_URL=redis://localhost:6379 npm start
   ```

5. **Run the frontend**:
   ```bash
   VITE_ALLOW_INSECURE_API=1 VITE_ALLOW_TURNSTILE_BYPASS=1 npm run dev
   ```
   The frontend will be available at `http://localhost:3000`.

   The local bypass is explicit and must never be enabled in a production build. For a local API running without the bypass, configure a real Turnstile site key instead.

### Environment Variables

Create a `.env` file in the root (see `.env.example`):

- `PORT`: API port (default: 3001).
- `REDIS_URL`: Connection string for Redis.
- `REDIS_PASSWORD`: URL-safe password for the private Redis instance when using Compose.
- `TURNSTILE_SECRET_KEY`: Your real Cloudflare Turnstile secret key; test keys are rejected in production.
- `TURNSTILE_ALLOWED_HOSTNAMES`: Comma-separated hostnames accepted in Turnstile verification responses.
- `TURNSTILE_ACTION`: Expected Turnstile action for secret creation (recommended in production).
- `CORS_ORIGIN`: Explicit comma-separated frontend origin allowlist; wildcard CORS is rejected in production.
- `TRUSTED_PROXY_IPS`: Comma-separated reverse-proxy addresses allowed to provide the client IP.
- `NODE_ENV`: Set to `production` for optimized builds.

The v2 API contract is metadata via `GET /api/secrets/:id/meta`, one atomic payload delivery via `POST /api/secrets/:id/reveal`, and sender-authorized deletion via `POST /api/secrets/:id/burn`. The former `GET`, `/access`, and `/consume` delivery paths are not registered and return a generic `404`; they never read or mutate secret state. There is no legacy client or record reader, so pre-v2 data is intentionally unsupported during cutover.

The Docker Compose file is production-shaped: it requires explicit secrets, publishes neither Redis nor the API port, and expects a reverse proxy attached to the private Compose network. It is not the local captcha-bypass path above.

## 🚢 Deployment

### Frontend (GitHub Pages)
The frontend is configured to deploy automatically to `blinddrop.atas.tech` via GitHub Actions on every push to the `master` branch.
- **Service Configuration**: Requires GitHub Variable `VITE_API_URL` with an `https://` URL and Secret `VITE_TURNSTILE_SITE_KEY`. The Vite build fails closed if either production value is missing or insecure.

### Backend (Docker/Unraid)
The backend is dockerized and can be built via the manual `Build and Push API Image` GitHub Action.
- **Docker Image**: `ghcr.io/atas-tech/blinddrop-api:latest`
- **Unraid**: An XML template is provided in `deploy/unraid/blinddrop-api.xml`.

## 📂 Project Structure

- `src/`: Frontend TypeScript source code.
- `server/`: Backend Fastify server logic.
- `public/`: Static assets (favicon, etc.).
- `deploy/`: Infrastructure templates.
- `e2e/`: Playwright end-to-end tests.

## 📝 License

Part of the **ATAS Tech** ecosystem. All rights reserved.
