# BlindDrop security hardening plan

**Status:** Repository implementation for Phases 1–4 is complete; independent Phase 4 cryptographic sign-off and live edge/release verification remain gated.
**Review date:** 2026-09-11 (baseline source verified against commit `cb0e024`; implementation update reflects the current working tree)
**Scope:** Secret entry, client encryption, transmission, retrieval, deletion, and supporting deployment controls.

## Implementation update

The repository now includes the Phase 1 and Phase 2 fixes, the required Phase 3 controls, the Phase 4 v2 crypto protocol, Redis-backed integration coverage, and a disposable API/frontend test stack. The retrieval contract is now a single at-most-once `POST /api/secrets/:id/reveal`; the former retrieval routes are removed and return generic `404` responses. New records are v2-only hashes with no legacy reader or auxiliary-key compatibility path. Security headers, no-store responses, strict request validation, fail-closed production configuration, hashed burn tokens, shared Redis rate limits, and private/authenticated Redis deployment templates are included.

No new runtime dependency was added for rate limiting, security headers, or cryptography: the implementation uses the existing Redis/Fastify primitives and browser WebCrypto. Phase 4 now ships a v2 PBKDF2/HKDF derivation and independent known-answer tests, but the required second-person cryptographic review/sign-off has not been performed by this implementation pass. Production edge configuration, deployed-revision confirmation, dependency-vulnerability remediation, and that review still require release-owner verification before sensitive production use.

## Assessment

BlindDrop encrypts secrets before uploading them and decrypts them in the recipient's browser. The v2 AES-256-GCM helpers passed isolated checks for round trips in both modes, Unicode content, random fragment keys, independent PBKDF2/HKDF vectors, and rejection of modified ciphertext, incorrect keys, incorrect passphrases, and malformed envelopes.

At the baseline revision, the service should not have been approved for sensitive production use until Phase 1 and Phase 2 were complete. The repository now contains those fixes; sensitive production approval still depends on the release evidence and hosting checks listed below. Three findings drove the implementation:

1. A crafted secret executes script in the recipient's browser.
2. Anyone who knows a secret ID can download the ciphertext of a passphrase-protected secret without consuming it, and can delete auxiliary keys through the generic retrieval route.
3. Creation is unprotected: rate limits exist only as config values, and the Turnstile secret defaults to Cloudflare's always-pass test key.

The current implementation preserves client-side encryption and adopts the v2 two-factor passphrase derivation from Phase 4. Its protocol details are documented below; production approval still requires the independent cryptographic sign-off specified by the review.

## Evidence and limits

The review inspected the source, deployment templates, GitHub Actions workflows, and e2e tests. It ran isolated checks against the crypto helpers with synthetic text, without starting the application or Redis. Read-only public requests inspected frontend HTML, its referenced JavaScript, and root response headers. No existing secrets were accessed and no secret was created on the live service.

Observed on 2026-09-11:

| Surface | Observation | Meaning |
| --- | --- | --- |
| Frontend, `blinddrop.atas.tech` (GitHub Pages) | HTTPS succeeded; HTTP returned `200` without redirect; no HSTS or CSP header | Pages cannot set custom response headers; header work requires a different edge |
| API, `blinddrop-api.atas.tech` | HTTPS succeeded; HTTP root returned `200` without redirect; no HSTS header | HTTPS enforcement is absent at the root |
| Deployed frontend JavaScript | Uses `https://blinddrop-api.atas.tech`; contains the unsafe plaintext interpolation | The rendering finding is live |
| API root CORS header | Allows `https://blinddrop.atas.tech` | Live configuration is narrower than the wildcard fallback in source |

Not established: deployed backend revision, TLS versions, per-route proxy and cache rules, proxy-to-origin encryption, firewall rules, Redis access controls, persistence settings, or backup retention. These need deployment verification by the hosting owner.

The checked boxes in the [existing test plan](testing/BlindDrop.md) are not evidence of current behavior. The plan marks security headers complete, but the code does not set them. Several documented routes differ from implementation. `npm test` is a stub; only the Playwright e2e specs run.

## Verified findings

Each finding was confirmed in source. Line numbers refer to `cb0e024`.

| ID | Finding | Location | Severity |
| --- | --- | --- | --- |
| F1 | Plaintext interpolated into `innerHTML` inside a textarea; `</textarea><img src=x onerror=...>` executes | `src/main.ts:414` | P0 |
| F2 | API error strings interpolated into `innerHTML` | `src/main.ts:442` | P0 |
| F3 | `POST /api/secrets/:id/access` returns ciphertext to anyone with the ID without consuming; a client that skips `/consume` can re-fetch after the 60 s lock expires | `server/app.ts:158` | P0 |
| F4 | `GET /api/secrets/:id` ignores the reservation lock; two retrieval paths exist for the same record | `server/app.ts:115` | P0 |
| F5 | Frontend ignores the `/consume` response status before displaying "Destroyed from server" | `src/main.ts:405` | P0 |
| F6 | Route param is not validated; `GET /api/secrets/<uuid>:salt` runs retrieve-and-burn against the salt key and bricks a passphrase secret. `:burn` and `:status` keys are reachable the same way | `server/app.ts:115` | P0 |
| F7 | Rate-limit values exist in config but nothing enforces them | `server/config.ts:8` | P1 |
| F8 | Turnstile secret defaults to the Cloudflare test key; unset production variable silently disables the captcha | `server/config.ts:5` | P1 |
| F9 | CORS falls back to `*` | `server/config.ts:4` | P1 |
| F10 | Redis published on host port `6379` in Compose; no auth, persistence defaults on | `docker-compose.yml` | P1 |
| F11 | No `Cache-Control: no-store` on secret responses; fragment key stays in the address bar for the tab lifetime | `server/app.ts`, `src/main.ts:457` | P1 |
| F12 | Retrieve Lua and `/burn` delete the payload but leave `:salt`, `:burn`, or `:lock` keys until TTL; `/burn` is not atomic | `server/app.ts:20`, `server/app.ts:200` | P1 |
| F13 | No request schema; unknown fields accepted, TTL silently defaults, IDs unchecked | `server/app.ts:70` | P1 |
| F14 | Secret is `.trim()`ed before encryption, altering whitespace-sensitive values | `src/main.ts:191` | P1 |
| F15 | `String.fromCharCode(...array)` spread on payloads near 100 KiB can exceed argument limits | `src/main.ts:35` | P1 |
| F16 | Burn token stored in plaintext in Redis | `server/app.ts:98` | P2 |
| F17 | Fastify default logger records full request URLs including secret IDs | `server/app.ts:15` | P2 |
| F18 | README and UI describe the passphrase as an "additional layer"; it replaces the random key, so a weak passphrase is weaker than the default mode | `README.md:14`, `index.html:72` | P2 |
| F19 | Unused `@fastify/static` import and dependency after headless conversion | `server/app.ts:3`, `package.json` | P3 |

Already correct and not requiring work: the reveal page requires a user click before any consuming request, so link previewers and page loads do not consume secrets. The metadata endpoint never returns the payload. Fragment material is never sent to the server.

## Security guarantees to adopt

1. Plaintext, passphrases, and decryption keys stay in the browser. The API receives encrypted envelopes and required metadata only.
2. Frontend and API traffic use authenticated HTTPS. Any hop beyond an explicitly trusted local boundary is encrypted.
3. Secret content is always displayed as text, never interpreted as HTML.
4. The server releases an encrypted envelope at most once. It cannot guarantee that a recipient views information only once or does not copy it.
5. Expiry and deletion remove the live server record. Claims about erasure must account for persistence, backups, and browser copies.
6. Client-side confidentiality assumes an uncompromised browser and authentic frontend JavaScript.

## Implementation plan

Each phase is one or more PRs. Acceptance criteria are written as the tests that should exist when the PR merges. Phases 1 and 2 block sensitive production use. Phase 3 is required hardening. Phase 4 is implemented in the repository; its independent cryptographic review remains a release gate.

### Phase 1: Immediate fixes (single PR, no design decisions needed)

Covers F1, F2, F5, F6, F14, F15, F19. All changes are small and independent of the retrieval redesign.

Changes:

- Build the result and error views with static markup or `document.createElement`, then set `textarea.value = plaintext` and `p.textContent = message`. Apply the same to the share-link textarea. Static icon `innerHTML` assignments with literal strings may remain.
- Add a UUID v4 regex check on `:id` in every route; return `404` on mismatch. This closes F6 before the record model changes.
- Check `consumeRes.ok` and the response body before rendering the "Destroyed from server" label. On failure, show the decrypted secret with a distinct message stating that server deletion was not confirmed.
- Remove `.trim()` from the secret input. Reject only when the value is empty or whitespace-only, without modifying the stored value.
- Replace `String.fromCharCode(...arr)` with a chunked loop or a `Uint8Array` to base64 helper. Add a UTF-8 byte-length check against the 100 KiB limit before encryption.
- Remove the `@fastify/static` import and dependency.

Acceptance criteria (Playwright unless noted):

- A secret equal to `</textarea><img src=x onerror=window.__xss=1>` renders literally, `window.__xss` is undefined, and no request to `x` is observed.
- An API error containing `<b>` markup renders as literal text.
- Multiline, leading/trailing whitespace, HTML entities, and Unicode secrets round-trip byte-exact.
- A 100 KiB UTF-8 payload round-trips; a 100 KiB + 1 byte payload is rejected client-side with a clear message.
- `GET /api/secrets/<uuid>:salt` returns `404` and the salt key remains intact (API test against real Redis).
- A mocked `/consume` returning `500` produces the "not confirmed" message, not the destroyed label.

### Phase 2: Single retrieval contract (one API PR, one frontend PR, coordinated release)

Covers F3, F4, F12, F16. Requires decision D1.

**Recommended contract: at-most-once server delivery.** One authenticated POST delivers the envelope and deletes it atomically. A lost response loses the secret; this matches the product's "link works exactly once" promise. Wrong-passphrase retries use the envelope already held in the tab.

Rejected alternative: reservation followed by confirmation. It is the current model. It allows silent ciphertext exfiltration by any party who knows the ID, permits redelivery after lease expiry, and makes the one-time claim untrue. Keep it only if recoverable delivery becomes a product requirement, and rewrite public wording if so.

API changes:

- Store one record per secret as a Redis hash: `v`, `ciphertext`, `salt` (optional), `burn_hash`, with one TTL. Remove the separate `:salt`, `:burn`, and `:lock` keys.
- `GET /api/secrets/:id/meta` reads only `salt` presence and status. Never returns the payload.
- `POST /api/secrets/:id/reveal` runs one Lua script: `HGETALL`, `DEL`, `SETEX <id>:status viewed`. Returns `ciphertext` and `salt` together so decryption never depends on a separate metadata read.
- `POST /api/secrets/:id/burn` runs one Lua script that compares `SHA-256(burnToken)` against `burn_hash`, deletes the hash, and sets `<id>:status burned`. Token comparison happens inside Redis so validation and deletion cannot interleave with a reveal.
- Remove `GET /api/secrets/:id`, `/access`, and `/consume` at the v2 cutover. The paths are not registered and return a generic `404`; they never return ciphertext or mutate state. No legacy client is supported.
- Store only the burn-token hash. Return the token once at creation.

Frontend changes:

- On reveal click: fetch meta if not already loaded, then `POST /reveal` once. Hold `ciphertext` and `salt` in closure scope only.
- Wrong passphrase: retry decryption against the in-memory envelope. No further network request. Explain that refresh cannot recover the secret.
- Distinguish three end states in the UI: decrypted and deleted from server; deleted from server but decryption failed; network failure where server state is unknown.

The v2 cutover intentionally breaks the old contract. Deploy the matching frontend and API together, start new records in the v2 hash format, and do not deliver, convert, or extend old records. Existing pre-v2 records and clients are outside the supported product surface; the operator may let them expire or remove them through an explicitly approved operational procedure. This implementation does not include a migration reader, drain, redirect, or deprecated-route compatibility handler.

Acceptance criteria (API tests against real Redis, plus Playwright for UI states):

- Ten concurrent `/reveal` calls for one ID yield exactly one `200` and nine `410`.
- Concurrent `/reveal` and `/burn` yield exactly one winner; the loser receives `410` and no payload.
- `/meta`, `GET`, `HEAD`, and page load never change record state.
- After `/reveal`, no key with prefix `secret:<id>` remains except the status tombstone.
- `/burn` with a wrong token returns `403` and leaves the record intact; the stored value is a hash, not the token.
- Wrong passphrase followed by correct passphrase decrypts with exactly one `/reveal` request observed.
- Existing e2e passphrase-flow spec is rewritten for the new contract; the lock-contention test is removed.
- `deprecated_retrieval_routes_are_removed`: old paths return generic `404` with no payload and no record change.
- `pre_v2_string_records_are_not_delivered_or_converted`: old string and hash records are not revealed, burned, converted, or given a new TTL.
- `new_client_never_falls_back_to_removed_routes`: network errors do not trigger a GET, `/access`, or `/consume` fallback.
- The v2-only cutover revision is recorded in release evidence; breaking pre-v2 clients and leaving pre-v2 records unsupported is an explicit product decision.

### Phase 3: Abuse controls, boundary validation, deployment hardening

Covers F7, F8, F9, F10, F11, F13, F17. Requires D2 for hosting, D3 for dependencies and D5 for the Redis capacity policy.

API changes:

- Fail closed at startup when `NODE_ENV=production` and `TURNSTILE_SECRET_KEY` is unset or equals a known Cloudflare test key. Same for `CORS_ORIGIN` equal to `*`.
- Validate the Turnstile response `hostname` against an allowlist and apply a 5 s timeout. Provider failure denies creation.
- Add `@fastify/rate-limit` backed by Redis. Separate limits for creation, meta, reveal, and burn. Trust `X-Forwarded-For` only from configured proxy addresses via Fastify `trustProxy`.
- Add `@fastify/helmet` for API responses and set `Cache-Control: no-store` on every `/api/secrets` response including errors.
- Add JSON schemas to every route body and params: `additionalProperties: false`, UUID format for IDs, TTL enum, base64 pattern and max length for `ciphertext` and `salt`, exact byte lengths for IV and salt after decoding. Reject an out-of-enum TTL instead of defaulting.
- Configure the Fastify logger to redact request bodies and to log route templates rather than resolved URLs.
- Both plugins must pass the dependency guardrail (Socket review) before `package.json` changes. Record the result in the PR description.

Frontend changes:

- Use `cache: 'no-store'` on secret fetches.
- Parse fragment parameters on load, then call `history.replaceState` to clear the hash. Show a note that refresh requires reopening the original link.
- Add `spellcheck="false"` and `autocomplete="off"` to secret fields.
- Fail the Vite build when `VITE_API_URL` is not `https://` unless `VITE_ALLOW_INSECURE_API=1` is set for local development.

Deployment changes:

- Remove `6379:6379` from Compose. Put API and Redis on a private Compose network. Set `requirepass` and an ACL limiting the API user to `HSET`, `HGETALL`, `DEL`, `SETEX`, `GET`, `EVALSHA`, `EVAL`, `EXPIRE`, and the rate-limit commands.
- Set `save ""`, `appendonly no`, `maxmemory`, and `maxmemory-policy noeviction`. Document that existing RDB files must be deleted manually.
- **Deliberate capacity policy, pending D5:** at the configured memory ceiling, reject new secret creation with a controlled `503` and no share link; do not evict an unexpired live secret to admit another. Record the selected memory ceiling, headroom for counters/tombstones and operational alert threshold. Redis restart/host failure can still lose ephemeral data: `noeviction` is not a durability guarantee. See [Redis eviction behavior](https://redis.io/docs/latest/develop/reference/eviction/).
- Test how Lua operations and the rate-limit adapter behave at capacity. `noeviction` can reject writes needed for counters or tombstones, not just creation. Do not promise that retrieval always succeeds on a full instance. On a failed operation, report an accurate error or uncertainty, never a false deletion acknowledgment. Recover capacity by allowing TTLs to expire or a reviewed capacity increase, not by silently enabling eviction or flushing active secrets.
- Update the Unraid template defaults accordingly and mark `CORS_ORIGIN` as required with no wildcard default.
- Move the frontend behind a header-capable edge (see D2). Set HSTS with a short `max-age` first, then extend. Set CSP allowing `'self'`, the API origin, and the Turnstile script, frame, and connect origins. Set `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Redirect HTTP to HTTPS for both hostnames.
- Restrict API port `3001` to the reverse proxy.

Acceptance criteria:

- Startup with a test Turnstile key and `NODE_ENV=production` exits non-zero with a clear message.
- The 101st creation from one IP within the window returns `429`; a spoofed `X-Forwarded-For` from an untrusted address does not reset the counter.
- A body with an unknown field, a non-UUID ID, or an unlisted TTL returns `400`.
- `curl -I` on every `/api/secrets` path shows `Cache-Control: no-store`.
- `curl -I http://` on both hostnames returns a `301` to HTTPS; HTTPS responses carry HSTS and the frontend carries CSP and framing headers.
- Redis is unreachable from outside the Compose network; `CONFIG GET save` returns empty and `appendonly` is `no`.
- Synthetic canary IDs and bodies do not appear in API logs.
- `redis_capacity_rejects_creation_without_evicting_live_secrets`: against a disposable real Redis, reach the configured ceiling and verify controlled `503`, no returned link or partial secret, and retention of an existing unexpired record. Use enough remaining TTL to distinguish expiry from eviction.
- `redis_capacity_failures_do_not_claim_successful_deletion`: exercise reveal/burn and limiter failure paths under memory pressure; require correct outcomes or explicit failure, without unsupported success claims. Confirm recovery after capacity is available again.
- D5 explicitly confirms the rejection-over-eviction tradeoff and records the chosen capacity/headroom. Do not run memory-exhaustion tests against production Redis.

### Phase 4: Passphrase mode and public wording

Covers F18. The repository implementation is complete; independent cryptographic sign-off remains required before release.

Immediate wording changes (can ship with Phase 1):

- README and UI describe the fragment key as required in both modes and describe passphrase mode as a second factor. They warn that anyone with the full link and a weak passphrase can guess offline.
- The privacy page states that fragment keys and passphrases never leave the browser, while the server retains only the v2 encrypted envelope, non-secret salt, and burn-token hash until reveal or expiry.

Shipped two-factor derivation:

- Generate a fresh random 256-bit fragment key in both modes and place its base64 representation only in the URL fragment.
- For passphrase mode, encode the passphrase as UTF-8, generate a fresh 128-bit salt, derive `kdfOut = PBKDF2-SHA-256(passphrase, salt, 600000)` with a 256-bit output, then compute `aesKey = HKDF-SHA-256(ikm = fragmentKey, salt = kdfOut, info = "blinddrop-v2")` with a 256-bit output.
- Prefix every AES-GCM envelope with version byte `0x02`, followed by a fresh 12-byte IV and the ciphertext/authentication tag. The API accepts and returns only version 2.
- In default mode, the fragment key is the AES-256-GCM key. In passphrase mode, the fragment key and passphrase-derived material are both required. The server-side copy alone is insufficient for offline guessing because the fragment key is never stored; the link alone is insufficient because the passphrase is required.

PBKDF2 and HKDF are standard primitives, but this application-specific composition still requires independent review. The implementation uses one derivation step, explicit lengths, UTF-8 encoding, and the `blinddrop-v2` domain-separation label; it does not support v1 or reinterpret unversioned legacy ciphertext.

**Merge gate:** name a second reviewer who did not implement the change and record their explicit sign-off on the exact revision before the Phase 4 crypto PR merges. D4 approves pursuing the change; it is not that cryptographic sign-off. This plan does not appoint or start a reviewer or sub-agent.

The second review must cover the HKDF input/salt roles, explicit PBKDF2 and HKDF output lengths, passphrase encoding, domain-separation label, AES-GCM IV/tag handling, version dispatch and downgrade resistance, and the stated attacker model. Require independently derived known-answer vectors as well as round-trip tests. Any subsequent change to the derivation, encoding, envelope or compatibility policy requires renewed sign-off.

Acceptance criteria:

- Documentation matches the shipped mode exactly.
- Version 2 is the only accepted create/reveal format; unversioned or v1 envelopes are rejected without a compatibility fallback.
- Wrong fragment key, wrong passphrase, modified version byte, and malformed envelopes all fail with the same generic error and no partial plaintext.
- `combined_derivation_matches_independent_vectors`: the specified output lengths, encoding, salt/input roles and domain label match independently calculated fixtures.
- The PR records the second reviewer's identity, reviewed revision, findings and explicit approval. Unresolved findings or missing sign-off block merge of the crypto change, without blocking earlier phases or accurate wording fixes.

## Deferred

Out of scope until the phases above are complete and the service is on a stable edge. Listed so they are not lost:

- HSTS preload submission.
- `rediss://` for Redis traffic. Not needed while API and Redis share a private Compose network on one host.
- Swap, core dump, and host backup audits for retention claims.
- Isolating Turnstile on a separate origin so its script does not run on the secret-entry page. Accept and document the provider trust for now.
- Memory zeroing of plaintext in JavaScript. Not achievable reliably; document instead.

## Decisions required

Phase 1 is independent of these decisions. D1 blocks Phase 2 release. D2, D3 and D5 block their respective Phase 3 hosting, dependency and Redis deployment items. D4 and the second-reviewer sign-off apply only to the Phase 4 crypto change; accurate wording can ship earlier.

- [ ] **D1** Accept at-most-once delivery and its response-loss tradeoff; confirm supported-client scope and the migration/cutover plan, including any accepted disruption to unknown clients. Owner: product, with the migration owner identified. Blocks Phase 2 release.
- [ ] **D2** Choose the header-capable edge for the frontend (Cloudflare Pages, Cloudflare proxy in front of GitHub Pages, or self-hosted static behind the existing API proxy). Identify the owner of DNS, proxy, and origin firewall. Blocks Phase 3 deployment items.
- [ ] **D3** Approve `@fastify/rate-limit` and `@fastify/helmet` after Socket review, or direct an in-house implementation. Blocks Phase 3 API items.
- [x] **D4** The requested implementation selects the `v2` combined derivation; the separate cryptographic review/sign-off remains a release gate. Product owner: request dated 2026-09-11.
- [ ] **D5** Confirm `noeviction`: reject new secrets at capacity rather than drop live ones; accept that writes for counters/tombstones can also fail at capacity. Owner: service operator and product. Record memory ceiling, headroom and recovery procedure before Phase 3 Redis rollout.

## Release evidence

Production approval for sensitive use requires all of the following attached to the release:

- [ ] Phase 1 and Phase 2 Playwright and API test runs, green, with the XSS regression and the concurrency tests included.
- [ ] Phase 3 startup fail-closed test, rate-limit test, and schema tests green.
- [ ] v2-only cutover evidence and removed-route/pre-v2-record tests attached; pre-v2 clients and records are explicitly unsupported.
- [ ] `curl -I` transcripts for HTTP redirect, HSTS, CSP, and `Cache-Control` on both hostnames.
- [ ] Redis configuration evidence for `save`, `appendonly`, `maxmemory` and `maxmemory-policy`, plus authentication and external-isolation checks. Record whether authentication is configured, never the `requirepass` value or another credential.
- [ ] D5 capacity-policy confirmation and disposable-Redis capacity/failure/recovery tests attached.
- [ ] If the Phase 4 crypto change is included, independent test vectors and the second reviewer's sign-off on the merged revision attached.
- [ ] Test plan in [testing/BlindDrop.md](testing/BlindDrop.md) rewritten so every checked item points to a runnable test or a recorded transcript.

Crypto unit checks alone are not production approval.

## References

- [Existing architecture brainstorm](Brainstorm_otp_service.md) and [test plan](testing/BlindDrop.md).
- [MDN: innerHTML security considerations](https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML).
- [MDN: URI fragments](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment).
- [MDN: Strict-Transport-Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security).
- [Cloudflare: Turnstile testing keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
- [Fastify: validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [@fastify/rate-limit](https://github.com/fastify/fastify-rate-limit), [@fastify/helmet](https://github.com/fastify/fastify-helmet).
- [Redis: security](https://redis.io/docs/latest/operate/oss_and_stack/management/security/), [persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/), and [ACL](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/).
- [RFC 5869: HKDF](https://www.rfc-editor.org/rfc/rfc5869).
- [OWASP: cryptographic storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) and [password work factors](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
