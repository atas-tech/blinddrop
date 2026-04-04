# BlindDrop 🛡️

**BlindDrop** is a standalone, public, one-time secret sharing service designed with a **zero-knowledge architecture**. It allows you to share sensitive information (passwords, API keys, etc.) securely, ensuring that even the server hosting the service never sees your plaintext data.

[![Frontend Deployment](https://github.com/atas-tech/blinddrop/actions/workflows/deploy-frontend.yml/badge.svg)](https://github.com/atas-tech/blinddrop/actions/workflows/deploy-frontend.yml)
[![API Build](https://github.com/atas-tech/blinddrop/actions/workflows/build-api.yml/badge.svg)](https://github.com/atas-tech/blinddrop/actions/workflows/build-api.yml)

## 🔐 Security Architecture

BlindDrop uses the **WebCrypto API** for client-side encryption:

- **Encryption**: Standard **AES-256-GCM** encryption performed entirely in your browser.
- **Key Strategy**: The encryption key is included in the URL fragment (`#`), which is never sent to the server.
- **Passphrase Protection**: Optional additional layer using **PBKDF2** to derive an AES key from your password.
- **Self-Destruction**: Secrets are stored in an ephemeral Redis instance and are permanently deleted after the first view or when the selected TTL (5m to 7d) expires.
- **Anti-Abuse**: Protected by **Cloudflare Turnstile** to prevent automated secret creation.

## 🛠️ Technology Stack

- **Frontend**: Vanilla TypeScript + Vite + Tailwind CSS.
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

3. **Start the environment**:
   Using Docker Compose is the easiest way to start both the API and Redis:
   ```bash
   docker-compose up -d
   ```

4. **Run the frontend**:
   ```bash
   npm run dev
   ```
   The frontend will be available at `http://localhost:3000`.

### Environment Variables

Create a `.env` file in the root (see `.env.example`):

- `PORT`: API port (default: 3001).
- `REDIS_URL`: Connection string for Redis.
- `TURNSTILE_SECRET_KEY`: Your Cloudflare Turnstile secret key.
- `NODE_ENV`: Set to `production` for optimized builds.

## 🚢 Deployment

### Frontend (GitHub Pages)
The frontend is configured to deploy automatically to `blinddrop.atas.tech` via GitHub Actions on every push to the `master` branch.
- **Service Configuration**: Requires GitHub Secrets `VITE_API_URL` (e.g., `https://pw-api.atas.tech`) and `VITE_TURNSTILE_SITE_KEY`.

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
