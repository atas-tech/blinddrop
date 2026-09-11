# BlindDrop — Public One-Time Secret Sharing Service

> Brainstorm for a standalone side project inspired by `@blindpass/browser-ui`  
> **Status:** MVP decisions finalized — ready for implementation, with sender-side status tracking intentionally deferred

> **Historical design note:** This brainstorm contains superseded v1 and v1.1 examples, including the former reservation-based `access`/`consume` flow. The current product is v2-only: use the contract and protocol in [the security review](security-review-2026-09-11.md). Do not implement or support the old routes, clients, or record formats.

---

## Decisions Log

| # | Question | Decision |
|---|----------|----------|
| 1 | Naming | **BlindDrop** ✅ |
| 2 | Branding | **Light-blue glassmorphism** — distinct from BlindPass dark theme, designed via Stitch |
| 3 | Repo structure | **`atas-tech/blinddrop`** — new standalone repo, UI + backend in one repo |
| 4 | Backend | **New minimal Fastify server** — SPS is overkill (see [§5](#5-why-not-reuse-sps)) |
| 5 | Domain | **blinddrop.atas.tech** |
| 6 | Storage | **Redis-only** (ephemeral, TTL-bound — no Postgres needed) |
| 7 | Max secret size | **100 KiB plaintext (UTF-8)**, with encoded payload cap enforced server-side |
| 8 | Abuse prevention | **Cloudflare Turnstile** |
| 9 | Priority | **Side project** — not a formal BlindPass phase |
| 10 | TTL options | **User's choice** — free-form input with sane presets, max 7 days |
| 11 | Homepage | **Create form is the homepage** — zero friction, no separate landing page |

---

## 1. The Idea

A **public, standalone web service** where any human (no account required) can:

1. **Create** a one-time secret (password, API key, note, credential, etc.)
2. **Get a shareable link** to send to another person
3. The recipient **opens the link and sees the secret exactly once** — then it's destroyed forever

Think: **OneTimeSecret / PrivNote / Yopass** — but with true client-side zero-knowledge encryption, a premium UI, and production-grade crypto.

---

## 2. What We Reuse From BlindPass

| Primitive | Source | How it's reused |
|-----------|--------|-----------------|
| Zero-knowledge architecture | SPS design philosophy | Same guarantee: server never sees plaintext |
| Ephemeral TTL + atomic delete-on-read | SPS Redis Lua scripts | Same Redis pattern (replicated, ~10 lines of Lua) |
| CSP-hardened browser page | `browser-ui/index.html` | Same security headers approach |
| One-time retrieval semantics | SPS `secret/retrieve` | Core behavior |
| UI patterns (trust panel, status chips, success flow) | `browser-ui` | Inspiration — new light-blue glassmorphism design via Stitch |
| Vite build pipeline | `browser-ui` | Same tooling |

> **Note:** We reuse **patterns and knowledge**, not code directly. BlindDrop is a clean standalone project with its own identity.

---

## 3. How It Differs From BlindPass

| Aspect | BlindPass | BlindDrop |
|--------|-----------|-----------|
| **Direction** | Human → Agent (or Agent → Agent) | Human → Human |
| **Auth required?** | Yes (signed session, workspace, JWT) | No (fully anonymous, public) |
| **Encryption** | HPKE (asymmetric, agent keypair) | AES-256-GCM (symmetric, key in URL fragment) |
| **Key management** | Server holds agent public key | Server never sees any key |
| **Use case** | DevOps credential delivery to AI agents | Sharing passwords, Wi-Fi keys, tokens with people |
| **Complexity** | Enterprise-grade, multi-package monorepo | Single repo, weekend-project scope |
| **License** | Mixed (AGPL + MIT) | MIT |

---

## 4. Crypto Architecture

### Model: Client-Side Symmetric Encryption (AES-256-GCM)

```
SENDER (browser):
  1. Generate random 256-bit AES key via WebCrypto
  2. Generate random 96-bit IV
  3. AES-256-GCM encrypt(key, iv, plaintext) → ciphertext
  4. POST {ciphertext, iv, ttl} to server → get secret_id
  5. Build link: blinddrop.atas.tech/s/{secret_id}#key={base64url_key}

RECIPIENT (browser):
  1. Parse secret_id from URL path
  2. Parse key from URL fragment (#key=...)
  3. GET /api/v1/secrets/{secret_id} → {ciphertext, iv} + atomic delete
  4. AES-256-GCM decrypt(key, iv, ciphertext) → plaintext
  5. Display plaintext
```

> **The URL fragment (`#key=...`) is never sent to the server** — this is enforced by the HTTP spec. The server only ever stores and returns ciphertext. True zero-knowledge.

### Why AES-256-GCM over HPKE?

- **Simpler**: One shared key, no keypair management
- **Zero-knowledge by design**: No key material on the server at all
- **No library needed**: WebCrypto is built into every browser
- **Proven model**: Same approach used by Yopass, hat.sh, etc.
- HPKE would require the server to hold a private key temporarily, breaking zero-knowledge

### Optional: Passphrase Protection (Post-MVP)

```
SENDER:
  1. User enters optional passphrase
  2. Generate random_salt
  3. PBKDF2(passphrase, random_salt) → aes_key
  4. Generate random 96-bit IV
  5. AES-256-GCM encrypt(aes_key, iv, plaintext) → ciphertext
  6. POST {ciphertext, iv, salt} to server
  7. Build link: blinddrop.atas.tech/s/{nanoid}
     (NO #key in URL — recipient needs passphrase)

RECIPIENT:
  1. Parse nanoid from URL path
  2. GET /api/v1/secrets/{nanoid}/meta → {salt, expires_at, passphrase_required}
  3. Enter passphrase
  4. POST /api/v1/secrets/{nanoid}/access → {ciphertext, iv, salt, access_token}
     (atomically reserve the secret for ~60s so concurrent opens fail closed)
  5. PBKDF2(passphrase, salt) → aes_key
  6. Decrypt locally
  7. On successful reveal, POST /api/v1/secrets/{nanoid}/consume with access_token → delete
     If decrypt fails or the browser closes, the reservation expires and the secret becomes retrievable again
```

> **Security Note:** While this prevents unauthorized access if the link is intercepted, it stores the ciphertext and salt on the server. If the server (or Redis dump) is compromised, an attacker can perform an offline dictionary/brute-force attack against the passphrase. Since human passphrases have low entropy, this is a known risk.

This adds a second factor: even if the link is intercepted, the secret can't be decrypted without the passphrase. It also requires a reservation-based retrieval flow rather than the MVP's simpler atomic GET+DELETE contract, so it is explicitly deferred from the initial implementation.

---

## 5. Why Not Reuse SPS?

| Concern | Detail |
|---------|--------|
| **Auth baggage** | SPS requires workspace auth, JWT validation, agent enrollment — none applicable to anonymous public use |
| **AGPL license** | SPS is AGPL-3.0; BlindDrop should be MIT for maximum adoption |
| **API surface** | SPS has ~30+ routes for workspaces, agents, policies, billing — BlindDrop MVP needs 3 routes |
| **Deployment coupling** | SPS needs PostgreSQL, Redis, JWKS — BlindDrop needs only Redis |
| **Scope creep** | Adding anonymous public routes to SPS would muddy its security model |
| **Backend is tiny** | The entire BlindDrop API is ~100-150 lines of Fastify. Writing fresh is faster than adapting SPS |

> The BlindDrop backend is so thin that it's essentially a Redis TTL wrapper with Turnstile validation. Building new takes less time than refactoring SPS.

---

## 6. Project Architecture

### Repo Structure

```
blinddrop/                          # NEW standalone repo
├── README.md
├── LICENSE                         # MIT
├── Dockerfile                      # Single container: Fastify serves API + static UI
├── docker-compose.yml              # BlindDrop + Redis
├── package.json
├── vite.config.ts
├── tsconfig.json
│
├── server/                         # Backend (Fastify + Redis)
│   ├── index.ts                    # Fastify server entry + static file serving
│   ├── routes/
│   │   ├── pages.ts                # GET / → index.html, GET /s/:id → reveal.html
│   │   └── secrets.ts              # POST create, GET retrieve, DELETE burn
│   ├── store/
│   │   └── redis.ts                # Redis client + atomic Lua scripts
│   ├── middleware/
│   │   └── turnstile.ts            # Cloudflare Turnstile verification
│   └── config.ts                   # Env vars, defaults
│
├── public/                         # Frontend (Vite-built static files)
│   ├── index.html                  # Sender: create secret page
│   └── reveal.html                 # Recipient: reveal secret page
│
├── src/                            # Frontend JS/CSS source
│   ├── create.ts                   # Sender logic: encrypt, POST, display link (homepage)
│   ├── reveal.ts                   # Recipient logic: GET, decrypt, display
│   ├── crypto.ts                   # WebCrypto AES-256-GCM helpers
│   ├── style.css                   # Light-blue glassmorphism theme (designed via Stitch)
│   └── shared.ts                   # Shared UI utilities
│
├── tests/
│   ├── crypto.test.ts              # Unit: encrypt → decrypt roundtrip
│   ├── api.test.ts                 # Integration: create → retrieve → gone
│   └── turnstile.test.ts           # Turnstile mock verification
│
└── deploy/
    └── unraid/
        └── blinddrop.xml           # Unraid Community App template
```

> **Routing note:** Fastify serves `GET /` with `index.html` and rewrites `GET /s/:id` to `reveal.html`. The recipient page reads the secret id from `location.pathname`; the encryption key remains in the URL fragment.

### Deployment Model

```
                   ┌──────────────────────────┐
                   │     blinddrop.atas.tech   │
                   │     (Cloudflare proxy)    │
                   │     + Turnstile           │
                   └───────────┬──────────────┘
                               │
                   ┌───────────▼──────────────┐
                   │   Docker Container        │
                   │                           │
                   │   Fastify Server          │
                   │   ├── /api/v1/*  (API)    │
                   │   └── /*  (static UI)     │
                   │                           │
                   └───────────┬──────────────┘
                               │
                   ┌───────────▼──────────────┐
                   │   Redis                   │
                   │   (TTL-bound ephemeral    │
                   │    ciphertext storage)    │
                   └──────────────────────────┘
```

Single container serves both API and static files. Redis is the only dependency.

---

## 7. API Surface

### `POST /api/v1/secrets` — Create Secret

**Request:**
```json
{
  "ciphertext": "base64url...",
  "iv": "base64url...",
  "ttl_seconds": 3600,
  "turnstile_token": "0.abc123..."
  // ttl_seconds: user's choice, min 300 (5m) max 604800 (7d)
}
```

**Response (201):**
```json
{
  "id": "V1StGXR8_Z5jdHi6B-myT",
  "burn_token": "xyz789...",
  "expires_at": "2026-03-30T00:00:00Z"
}
```

**Constraints:**
- Fastify configured with custom `bodyLimit`: `256kb` (Drops large payloads at the HTTP parser level).
- Plaintext max: `100 KiB` UTF-8 before encryption
- Encoded payload max: roughly `200 KB` for `ciphertext` (base64url AES-GCM output + JSON overhead must stay below `bodyLimit`)
- `ttl_seconds`: user's choice, min 300 (5 min), max 604800 (7 days); presets offered but custom input allowed
- Turnstile token required (verified server-side)

---

### `GET /api/v1/secrets/:id` — Retrieve & Burn

**Response (200):**
```json
{
  "ciphertext": "base64url...",
  "iv": "base64url..."
}
```

**Behavior:** Atomic GET + DELETE via Redis Lua script. Second request returns `404`.

**Error codes:**
- `404` — secret does not exist, was already retrieved, was burned early, or expired

> **State model note:** For a premium user experience, the MVP incorporates a basic metadata Tombstone model. Instead of a generic `404`, the server writes a lightweight tombstone upon retrieval, early burn, or expiration, allowing the UI to explicitly tell the user whether the secret was already viewed, was burned by the sender, or has expired.

---

### `DELETE /api/v1/secrets/:id` — Early Burn

**Headers:** `Authorization: BurnToken xyz789...`

Sender-initiated destruction before recipient opens the link. Requires the `burn_token` returned at creation time.

> **Transport note:** MVP uses the standard `Authorization` header rather than a custom `X-Burn-Token` header so it survives common proxy/CDN setups more reliably. Query-string burn tokens are intentionally avoided because they are more likely to leak via access logs, caches, and browser history.
>
> **Operational note:** In MVP this endpoint also acts as a destructive sender-side probe. A `200` means the secret still existed and is now burned; a `404` means it was already consumed, expired, or previously burned. This is intentionally not exposed as a friendly "status check" UI because it changes state.

---

## 8. UX Flow

### Homepage = Create Form (`/`)

The homepage IS the create form — zero friction, no landing page.
Design: light-blue glassmorphism with frosted glass cards over a soft gradient background.

```
┌──────────────────────────────────────────┐
│  ░░░░░░░ soft blue gradient bg ░░░░░░░  │
│                                          │
│   ┌─── frosted glass card ───────────┐  │
│   │       🔐  BlindDrop              │  │
│   │  Share secrets that self-destruct│  │
│   │                                  │  │
│   │  ┌──────────────────────────┐    │  │
│   │  │ Enter your secret...     │    │  │
│   │  │ (password / API key)     │    │  │
│   │  └──────────────────────────┘    │  │
│   │                                  │  │
│   │  ⏱ Expires after:               │  │
│   │  [5m] [1h] [24h] [7d] [Custom]  │  │
│   │  ┌──────────┐                    │  │
│   │  │ 2h 30m   │  (if Custom)      │  │
│   │  └──────────┘                    │  │
│   │                                  │  │
│   │  [ 🔒 Create Secret Link ]      │  │
│   └──────────────────────────────────┘  │
│                                          │
│   ┌─── how it works (subtle) ────────┐  │
│   │ 1. Encrypted in your browser     │  │
│   │ 2. Only ciphertext is stored     │  │
│   │ 3. Link works exactly once       │  │
│   │ 4. Then it's gone forever        │  │
│   └──────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

### Link Created (same page, after submit)

```
┌──────────────────────────────────────────┐
│   ✅ Secret created!                     │
│                                          │
│   Share this link (works once):          │
│   ┌────────────────────────────────────┐ │
│   │ https://blinddrop.atas.tech/      │ │
│   │ s/V1StGXR8...#key=Bx7kQ...         │ │
│   └────────────────────────────────────┘ │
│   [ 📋 Copy ]  [ 📧 Email ]  [ 📱 QR ] │
│                                          │
│   ⚠️ Save this link now. You won't see  │
│   it again. Expires in 1 hour.           │
│                                          │
│   [ Create Another ]                     │
└──────────────────────────────────────────┘
```

### Recipient Page (`/s/:id#key=...`)

Same glassmorphism aesthetic, focused on the reveal action.

```
┌──────────────────────────────────────────┐
│           🔐  BlindDrop                  │
│                                          │
│   Someone shared a secret with you.      │
│   It can only be viewed once.            │
│                                          │
│   [       👁️ Reveal Secret             ] │
│                                          │
└──────────────────────────────────────────┘
            │ click (this triggers the GET /api/v1/secrets/:id XHR)
            │ *CRITICAL: Do NOT fetch on page load to prevent Slack/Discord bots from burning the secret.*
            ▼
┌──────────────────────────────────────────┐
│   Your secret:                           │
│   ┌────────────────────────────────────┐ │
│   │ MyS3cur3P@ssw0rd!                 │ │
│   └────────────────────────────────────┘ │
│   [ 📋 Copy to Clipboard ]              │
│                                          │
│   🔥 This secret has been destroyed.     │
│   The link will no longer work.          │
│                                          │
│   [ Close ]                              │
└──────────────────────────────────────────┘
```

### Already Viewed / Expired / Burned

```
┌──────────────────────────────────────────┐
│           🔐  BlindDrop                  │
│                                          │
│   ❌ This secret is no longer available. │
│                                          │
│   Reason: It was already viewed by       │
│   someone else 2 hours ago.              │
│                                          │
│   [ Create Your Own Secret → ]           │
└──────────────────────────────────────────┘
```

---

## 9. Features by Priority

### v1 — MVP (Weekend Sprint)

- [ ] Create secret (text input, single or multiline)
- [ ] Client-side AES-256-GCM encryption via WebCrypto
- [ ] Generate shareable link with key in URL fragment
- [ ] One-time retrieval (burn after reading, atomic Redis Lua)
- [ ] TTL selection: preset buttons (5m, 1h, 24h, 7d) + custom duration input
- [ ] Copy link button
- [ ] Cloudflare Turnstile on create
- [ ] Light-blue glassmorphism theme (designed via Stitch)
- [ ] Mobile responsive
- [ ] CSP headers, no-iframe, no-referrer
- [ ] Sender can burn secret early (`DELETE` with burn token)
- [ ] Docker + docker-compose for deployment
- [ ] 100 KiB plaintext max secret size

### v1.1 — Polish

- [ ] Passphrase protection with reservation-based retrieval (metadata -> access -> consume)
- [ ] QR code for the link
- [ ] Sender-scoped status endpoint with burn-token auth and tombstone metadata (only if real users actually need sender-side tracking)
- [ ] "Secret viewed" notification (optional email)
- [ ] View-count option (allow N views instead of 1)
- [ ] Keyboard shortcuts (Ctrl+Enter to create, etc.)
- [ ] Dark/light mode toggle

### v2 — Growth

- [ ] File attachment support (encrypt small files, ≤100 KiB)
- [ ] Optional sender account (track secrets, view status)
- [ ] API access with rate-limited keys
- [ ] CLI tool (`npx blinddrop "my secret"`)
- [ ] Slack / Discord bot integration
- [ ] Unraid Community App template
- [ ] BlindPass cross-promotion: "Need to share secrets with AI agents? →"

---

## 10. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Frontend** | Vanilla HTML/TypeScript | Zero dependencies, fast, auditable |
| **Styling** | Vanilla CSS | Light-blue glassmorphism theme designed via Stitch |
| **Build** | Vite | Fast, proven, same as browser-ui |
| **Server** | Fastify (TypeScript) | Lightweight, fast, familiar |
| **Storage** | Redis | Ephemeral by nature, TTL built-in, atomic Lua |
| **Encryption** | WebCrypto `AES-256-GCM` | Native browser API, zero dependencies |
| **Abuse prevention** | Cloudflare Turnstile | Free, invisible, no UX friction |
| **Deploy** | Docker (single container) | Fastify serves API + static UI |
| **CI** | GitHub Actions | Standard |

---

## 11. Competitive Landscape

| Service | Zero-knowledge? | Open source? | Self-host? | Passphrase? | File support? | UI quality |
|---------|----------------|--------------|-----------|-------------|---------------|------------|
| OneTimeSecret | ❌ Server-side | ❌ | ❌ | ✅ | ❌ | Basic |
| PrivNote | ❌ Server-side | ❌ | ❌ | ❌ | ❌ | Basic |
| Yopass | ✅ Client-side | ✅ | ✅ | ❌ | ❌ | Minimal |
| Password Pusher | ❌ Server-side | ✅ | ✅ | ✅ | ❌ | Decent |
| **BlindDrop** | ✅ Client-side | ✅ | ✅ | ✅ (post-MVP) | ✅ (v2) | **Premium** |

**Key differentiators:**
1. **True zero-knowledge** — encryption key never touches the server
2. **Premium, designed UI** — not an afterthought (Stitch-designed theme)
3. **Self-hostable** — Docker one-liner, Unraid template
4. **Part of the BlindPass ecosystem** — credibility from a production security product
5. **MIT licensed** — maximum adoption

---

## 12. Redis Data Model

### Secret Record

**Key:** `blinddrop:secret:{id}`
**Type:** Hash
**TTL:** User-selected (300s – 604800s)

```
{
  "ciphertext": "base64url...",      // Encrypted secret derived from max 100 KiB plaintext
  "iv": "base64url...",              // AES-GCM initialization vector
  "burn_token_hash": "sha256...",    // Hashed burn token for sender-initiated delete
  "created_at": "1711756800"         // Unix timestamp
}
```

### Atomic Retrieve Lua Script with Tombstones

```lua
-- GET + DELETE + SET TOMBSTONE in one atomic operation
local key = KEYS[1]
local tombstone_key = KEYS[2] -- blinddrop:tombstone:{id}
local data = redis.call('HGETALL', key)

if #data == 0 then
  -- Secret not found. Check if tombstone exists.
  local reason = redis.call('GET', tombstone_key)
  return { tombstone = reason or 'expired_or_invalid' }
end

-- It exists. Delete it and replace with a viewed tombstone matching the remaining TTL
local ttl = redis.call('TTL', key)
redis.call('DEL', key)
if ttl > 0 then
  redis.call('SETEX', tombstone_key, ttl, 'viewed')
end

return data
```

By setting a tombstone upon consumption or early burn, the API explicitly distinguishes:
- `viewed`: Already opened by a recipient.
- `burned`: Sender destroyed it early.
- `expired_or_invalid`: Fallback for when no live secret or tombstone exists.

This directly supports the premium UX goal of explicit error states.

### Rate Limit Key

**Key:** `blinddrop:ratelimit:{ip}:{window}`
**Type:** Counter with TTL
**Limits:** 100 creates/hour per IP (adjustable)

### Server Constraints for Abuse Mitigation

- **Redis Memory Profile:** Configure Redis instance with `maxmemory 100mb` and `maxmemory-policy volatile-ttl` to prevent OOM (Out Of Memory) crashes if a botnet manages to spam ~100 KiB plaintext-equivalent payloads bypassing Turnstile.

---

## 13. Security Model

| Control | Implementation |
|---------|---------------|
| **Zero-knowledge** | AES key in URL fragment, never sent to server |
| **One-time retrieval** | Atomic GET+DELETE via Redis Lua |
| **Abuse prevention** | Cloudflare Turnstile on create |
| **Rate limiting** | IP-based, 20 creates/hour |
| **CSP** | `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; object-src 'none'; base-uri 'none'` |
| **No iframe** | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` |
| **No referrer** | `Referrer-Policy: no-referrer` |
| **HTTPS only** | `Strict-Transport-Security` via Cloudflare |
| **Payload limit** | 100 KiB plaintext, encoded payload capped server-side |
| **TTL enforcement** | Redis native TTL, max 7 days |
| **Burn token** | SHA-256 hashed, only sender can early-delete |

---

## 14. Rough Timeline

| Phase | Scope | Effort |
|-------|-------|--------|
| **Day 1** | Design UI in Stitch (light-blue glassmorphism) | 2–3 hours |
| **Day 1-2** | Implement crypto + API + Redis | 4–6 hours |
| **Day 2** | Build sender + recipient UI pages | 4–6 hours |
| **Day 3** | Turnstile, Docker, deploy to blinddrop.atas.tech | 3–4 hours |
| **Day 3** | Tests, polish, README | 2–3 hours |
| **Post-launch** | Passphrase, QR, file support | Ongoing |

---

## 15. Design Direction: Light-Blue Glassmorphism

### Visual Identity

- **Background**: Soft gradient — light blue to white, or light blue to lavender
- **Cards**: Frosted glass effect (`backdrop-filter: blur(16px)`, semi-transparent white `rgba(255,255,255,0.15)`)
- **Borders**: Subtle `1px solid rgba(255,255,255,0.3)` on glass cards
- **Accent color**: Vibrant blue (`#3B82F6` or similar) for CTAs and interactive elements
- **Text**: Dark text on light glass for readability; white text where needed on darker glass
- **Shadows**: Soft, diffused box-shadows for depth
- **Typography**: Clean sans-serif (Inter or similar)
- **Animations**: Subtle hover glow on buttons, smooth transitions on state changes
- **Mood**: Clean, trustworthy, modern — like a premium SaaS product, not a hacker tool

### Contrast with BlindPass

| Element | BlindPass | BlindDrop |
|---------|-----------|----------|
| Background | Dark (`#0a0a0f`) | Light blue gradient |
| Cards | Dark with subtle borders | Frosted glass |
| Accent | Green/teal | Vibrant blue |
| Mood | Security-serious, enterprise | Clean, approachable, modern |
| Typography | Monospace hints | Clean sans-serif |

---

## 16. Testing Plan

The initial integration and E2E scenarios for this side project are tracked in [docs/testing/BlindDrop.md](../testing/BlindDrop.md). Once the standalone `atas-tech/blinddrop` repo exists, that test plan should move with the codebase.
