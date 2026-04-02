# BlindDrop MVP Test Plan

This plan defines the minimum integration and end-to-end coverage for the BlindDrop standalone one-time secret sharing service.

BlindDrop will live in its own repository, but the scenarios are defined here first so the architecture proposal is paired with concrete verification requirements.

## Preconditions

- A local BlindDrop dev environment is available with Fastify and Redis
- Browser tests can run against a real built recipient page, not only isolated crypto helpers
- Turnstile verification can be mocked in automated tests and disabled only in explicit local-dev mode
- Redis is configured with TTL support and the same Lua script behavior used in production

## Milestone 1: UI/UX Design System

- [ ] **Design 001: Establish Stitch Design System**
  - [ ] Establish light-blue glassmorphism theme with Stitch
  - [ ] Create and document `.stitch/DESIGN.md` as the source of truth

## Milestone 2: Crypto And Input Validation

- [ ] **Unit 001: AES-GCM roundtrip succeeds for normal plaintext**
  - [ ] Encrypt a plaintext in the browser crypto helper
  - [ ] Decrypt with the same key and IV
  - [ ] Assert byte-for-byte equality

- [ ] **Unit 002: URL fragment key encoding is lossless**
  - [ ] Generate a random 256-bit key
  - [ ] Encode to base64url for the share link
  - [ ] Decode back into raw key bytes
  - [ ] Assert equality

- [ ] **Unit 003: Size limits are enforced on plaintext before submit**
  - [ ] Submit a `100 KiB` UTF-8 plaintext
  - [ ] Assert the client accepts it
  - [ ] Submit a `100 KiB + 1 byte` plaintext
  - [ ] Assert the client rejects before network send

- [ ] **Integration 004: Server rejects oversized encoded payloads**
  - [ ] POST a request slightly below the encoded payload cap
  - [ ] Assert success
  - [ ] POST a request above the cap or body limit
  - [ ] Assert `413` or the chosen validation error

## Milestone 3: Core Secret Lifecycle

- [ ] **Integration 101: Create -> retrieve -> second retrieve returns not found**
  - [ ] Create a secret successfully
  - [ ] Retrieve it once
  - [ ] Attempt a second retrieval
  - [ ] Assert the second call returns `404`

- [ ] **Integration 102: Early burn destroys the secret**
  - [ ] Create a secret and capture the `burn_token`
  - [ ] Call `DELETE /api/v1/secrets/:id` with `Authorization: BurnToken ...`
  - [ ] Attempt retrieval
  - [ ] Assert retrieval returns `404`

- [ ] **Integration 103: Invalid burn token fails closed**
  - [ ] Create a secret
  - [ ] Attempt early burn with an invalid `Authorization: BurnToken ...` header
  - [ ] Assert the secret is not deleted
  - [ ] Retrieve once with the real link and assert success

- [ ] **Integration 104: Expired/missing secrets return explicit tombstone reason**
  - [ ] Create a short-lived secret
  - [ ] Wait for TTL expiry
  - [ ] Retrieve it
  - [ ] Assert the response explicitly states the reason using the new tombstone logic

- [ ] **Integration 105: Invalid TTL values are rejected**
  - [ ] Try TTL below `300`
  - [ ] Try TTL above `604800`
  - [ ] Assert validation failure in both cases

## Milestone 4: Abuse Controls And Headers

- [ ] **Integration 201: Turnstile is required on create**
  - [ ] Submit without a Turnstile token
  - [ ] Assert rejection
  - [ ] Submit with a mocked valid token
  - [ ] Assert success

- [ ] **Integration 202: IP rate limit throttles repeated creates**
  - [ ] POST create requests from one test IP until the threshold is exceeded
  - [ ] Assert the server returns `429`
  - [ ] Assert a different IP is still accepted

- [ ] **Integration 203: Security headers match the documented model**
  - [ ] Request `/`
  - [ ] Assert `Content-Security-Policy`, `Referrer-Policy`, and `X-Frame-Options` are present
  - [ ] Assert the CSP explicitly allows the Turnstile domains and denies framing

## Milestone 5: Browser E2E Flow

- [ ] **E2E 301: Homepage creates a share link with key in the fragment**
  - [ ] Open `/`
  - [ ] Enter a secret and complete Turnstile
  - [ ] Create a link
  - [ ] Assert the rendered URL contains `/s/:id#key=...`
  - [ ] Assert the fragment key is not present in network requests

- [ ] **E2E 302: Recipient page does not fetch on initial load**
  - [ ] Open `/s/:id#key=...`
  - [ ] Assert no retrieval request is made before clicking Reveal

- [ ] **E2E 303: Reveal button fetches once and shows plaintext**
  - [ ] Click Reveal
  - [ ] Assert one retrieve request is sent
  - [ ] Assert the plaintext is displayed
  - [ ] Refresh or revisit and assert the secret is unavailable

- [ ] **E2E 304: Explicit failure UI for viewed, burned, and expired secrets**
  - [ ] Exercise separate runs for consumed, early-burned, and expired secrets
  - [ ] Assert the UI explicitly states why the secret is unavailable based on tombstone metadata

- [ ] **E2E 305: `/s/:id` routing serves the reveal shell**
  - [ ] Request a direct recipient URL from a clean browser session
  - [ ] Assert the server returns the reveal page shell
  - [ ] Assert the page reads the secret id from `location.pathname`

## Milestone 6: Post-MVP Passphrase Mode

- [ ] **Integration 401: Metadata fetch does not consume a passphrase-protected secret**
  - [ ] Create a passphrase-protected secret in the future reservation-based mode
  - [ ] Request metadata only
  - [ ] Assert the secret remains retrievable

- [ ] **Integration 402: Wrong passphrase does not permanently burn the secret**
  - [ ] Acquire a reservation
  - [ ] Attempt decrypt with the wrong passphrase
  - [ ] Let the reservation expire
  - [ ] Retry with the correct passphrase and assert success

- [ ] **Integration 403: Reservation prevents concurrent reveals**
  - [ ] Start two near-simultaneous access attempts
  - [ ] Assert only one receives the reservation token
  - [ ] Assert the other is denied or told to retry later

## Exit Criteria

- The MVP create -> reveal -> destroy flow works exactly once
- Missing or consumed secrets return clear, explicit tombstone reasons instead of generic responses
- Early burn is sender-authorized and does not leak token material
- The recipient page never burns the secret on page load
- The documented CSP works with Turnstile instead of blocking it
- Oversized inputs and repeated abuse are rejected predictably
