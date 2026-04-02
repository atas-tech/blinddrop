# BlindDrop MVP Test Plan

This plan defines the minimum integration and end-to-end coverage for the BlindDrop standalone one-time secret sharing service.

BlindDrop will live in its own repository, but the scenarios are defined here first so the architecture proposal is paired with concrete verification requirements.

## Preconditions

- A local BlindDrop dev environment is available with Fastify and Redis
- Browser tests can run against a real built recipient page, not only isolated crypto helpers
- Turnstile verification can be mocked in automated tests and disabled only in explicit local-dev mode
- Redis is configured with TTL support and the same Lua script behavior used in production

## Milestone 1: UI/UX Design System

- [x] **Design 001: Establish Stitch Design System**
  - [x] Establish light-blue glassmorphism theme with Stitch
  - [x] Create and document `.stitch/DESIGN.md` as the source of truth

## Milestone 2: Crypto And Input Validation

- [x] **Unit 001: AES-GCM roundtrip succeeds for normal plaintext**
  - [x] Encrypt a plaintext in the browser crypto helper
  - [x] Decrypt with the same key and IV
  - [x] Assert byte-for-byte equality

- [x] **Unit 002: URL fragment key encoding is lossless**
  - [x] Generate a random 256-bit key
  - [x] Encode to base64url for the share link
  - [x] Decode back into raw key bytes
  - [x] Assert equality

- [x] **Unit 003: Size limits are enforced on plaintext before submit**
  - [x] Submit a `100 KiB` UTF-8 plaintext
  - [x] Assert the client accepts it
  - [ ] Submit a `100 KiB + 1 byte` plaintext
  - [ ] Assert the client rejects before network send

- [x] **Integration 004: Server rejects oversized encoded payloads**
  - [ ] POST a request slightly below the encoded payload cap
  - [ ] Assert success
  - [ ] POST a request above the cap or body limit
  - [ ] Assert `413` or the chosen validation error

## Milestone 3: Core Secret Lifecycle

- [x] **Integration 101: Create -> retrieve -> second retrieve returns not found**
  - [x] Create a secret successfully
  - [x] Retrieve it once
  - [x] Attempt a second retrieval
  - [x] Assert the second call returns `404`

- [x] **Integration 102: Early burn destroys the secret**
  - [x] Create a secret and capture the `burn_token`
  - [x] Call `DELETE /api/v1/secrets/:id` with `Authorization: BurnToken ...`
  - [x] Attempt retrieval
  - [x] Assert retrieval returns `404`

- [x] **Integration 103: Invalid burn token fails closed**
  - [x] Create a secret
  - [x] Attempt early burn with an invalid `Authorization: BurnToken ...` header
  - [x] Assert the secret is not deleted
  - [x] Retrieve once with the real link and assert success

- [x] **Integration 104: Expired/missing secrets return explicit tombstone reason**
  - [x] Create a short-lived secret
  - [x] Wait for TTL expiry
  - [x] Retrieve it
  - [x] Assert the response explicitly states the reason using the new tombstone logic

- [x] **Integration 105: Invalid TTL values are rejected**
  - [x] Try TTL below `300`
  - [x] Try TTL above `604800`
  - [x] Assert validation failure in both cases

## Milestone 4: Abuse Controls And Headers

- [x] **Integration 201: Turnstile is required on create**
  - [x] Submit without a Turnstile token
  - [x] Assert rejection
  - [x] Submit with a mocked valid token
  - [x] Assert success

- [ ] **Integration 202: IP rate limit throttles repeated creates**
  - [ ] POST create requests from one test IP until the threshold is exceeded
  - [ ] Assert the server returns `429`
  - [ ] Assert a different IP is still accepted

- [x] **Integration 203: Security headers match the documented model**
  - [x] Request `/`
  - [x] Assert `Content-Security-Policy`, `Referrer-Policy`, and `X-Frame-Options` are present
  - [x] Assert the CSP explicitly allows the Turnstile domains and denies framing

## Milestone 5: Browser E2E Flow

- [x] **E2E 301: Homepage creates a share link with key in the fragment**
  - [x] Open `/`
  - [x] Enter a secret and complete Turnstile
  - [x] Create a link
  - [x] Assert the rendered URL contains `/#id=...&key=...`
  - [x] Assert the fragment key is not present in network requests

- [x] **E2E 302: Recipient page does not fetch on initial load**
  - [x] Open `/#id=...&key=...`
  - [x] Assert no retrieval request is made before clicking Reveal

- [x] **E2E 303: Reveal button fetches once and shows plaintext**
  - [x] Click Reveal
  - [x] Assert one retrieve request is sent
  - [x] Assert the plaintext is displayed
  - [x] Refresh or revisit and assert the secret is unavailable

- [x] **E2E 304: Explicit failure UI for viewed, burned, and expired secrets**
  - [ ] Exercise separate runs for consumed, early-burned, and expired secrets
  - [x] Assert the UI explicitly states why the secret is unavailable based on tombstone metadata

- [x] **E2E 305: `/s/:id` routing serves the reveal shell**
  - [x] Request a direct recipient URL from a clean browser session
  - [x] Assert the server returns the reveal page shell
  - [x] Assert the page reads the secret id from `location.hash`

## Milestone 6: Post-MVP Passphrase Mode

- [x] **Integration 401: Metadata fetch does not consume a passphrase-protected secret**
  - [x] Create a passphrase-protected secret in the future reservation-based mode
  - [x] Request metadata only
  - [x] Assert the secret remains retrievable

- [x] **Integration 402: Wrong passphrase does not permanently burn the secret**
  - [x] Acquire a reservation
  - [x] Attempt decrypt with the wrong passphrase
  - [x] Let the reservation expire
  - [x] Retry with the correct passphrase and assert success

- [x] **Integration 403: Reservation prevents concurrent reveals**
  - [x] Start two near-simultaneous access attempts
  - [x] Assert only one receives the reservation token
  - [x] Assert the other is denied or told to retry later

## Exit Criteria

- The MVP create -> reveal -> destroy flow works exactly once
- Missing or consumed secrets return clear, explicit tombstone reasons instead of generic responses
- Early burn is sender-authorized and does not leak token material
- The recipient page never burns the secret on page load
- The documented CSP works with Turnstile instead of blocking it
- Oversized inputs and repeated abuse are rejected predictably
