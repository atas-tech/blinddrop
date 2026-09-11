# BlindDrop security test plan

The automated suite exercises the v2-only Fastify routes, Redis Lua scripts, and browser client. Integration tests require a real Redis server; set `TEST_REDIS_URL` to an isolated disposable instance when `redis-server` is not installed locally. Playwright starts a disposable Redis process, the API, and the Vite frontend through `scripts/test-stack.ts`.

## Commands

```bash
npm ci --ignore-scripts
npm run build:server
VITE_ALLOW_INSECURE_API=1 VITE_ALLOW_TURNSTILE_BYPASS=1 npm run build
node --import tsx --test tests/integration/crypto-v2.test.ts
npm run test:integration
npm run test:e2e
npm test
```

The insecure API and Turnstile bypass flags are test/local-development overrides only. Production builds must provide an HTTPS `VITE_API_URL` and a real `VITE_TURNSTILE_SITE_KEY`.

## Protocol coverage

`tests/integration/crypto-v2.test.ts` checks the shipped v2 format:

- every envelope starts with version byte `0x02`, contains a 12-byte AES-GCM IV, and ends with a 16-byte authentication tag;
- every mode uses a random 32-byte fragment key;
- passphrase mode uses UTF-8 PBKDF2-SHA-256 with 600,000 iterations and a 32-byte output, then HKDF-SHA-256 with the fragment key as IKM, the PBKDF2 output as salt, and `blinddrop-v2` as `info`;
- independently calculated known-answer vectors match the WebCrypto implementation; and
- wrong keys/passphrases, changed versions, truncated envelopes, and malformed encodings fail without returning plaintext.

There is no v1 fallback, legacy envelope decoder, or compatibility derivation.

## Automated coverage

### API route and lifecycle tests

`tests/integration/secret-routes.test.ts` covers UUID-v4 rejection on every ID-bearing route, encoded auxiliary-key suffixes, absence of the former retrieval routes, metadata, and valid v2 reveal behavior.

`tests/integration/secret-lifecycle.test.ts` covers:

- at-most-once delivery under ten concurrent reveal requests;
- the atomic reveal-versus-burn race;
- hashed burn-token authorization and wrong-token preservation;
- one v2 hash plus one bounded tombstone as the only terminal residue;
- non-consuming metadata requests;
- generic `404` responses for removed retrieval paths without state changes; and
- rejection of synthetic pre-v2 string and hash records without conversion, burning, or payload delivery.

`tests/integration/api-boundaries.test.ts` covers required v2 versioning, unknown/null bodies, TTL and base64 validation, the 100 KiB encoded payload boundary, `Cache-Control: no-store`, and the API security-header baseline.

`tests/integration/abuse-controls.test.ts` covers fail-closed production configuration, Turnstile rejection, the creation limiter before verification, shared counters across API instances, forwarded-header spoofing, and limiter outages.

### Browser tests

`e2e/core-flow.spec.ts` covers link creation with the fragment key, fragment clearing, click-only reveal, one `POST /reveal`, and the absence of removed retrieval routes.

`e2e/passphrase-flow.spec.ts` covers v2 passphrase links, metadata-only page load, one-request wrong-passphrase retry from tab memory, and network uncertainty without a false deletion claim.

`e2e/security-regressions.spec.ts` covers literal XSS rendering, literal API-error rendering, whitespace/Unicode round trips, and the 100 KiB UTF-8 client limit.

## Manual deployment and release evidence still required

The code and Compose template do not prove the live edge configuration. Before sensitive production use, attach evidence for HTTP-to-HTTPS redirects, frontend CSP/HSTS/framing headers, reverse-proxy-only API access, Redis network isolation/authentication, Redis `save`, `appendonly`, `maxmemory`, and `maxmemory-policy`, proxy-to-origin encryption, firewall rules, backups, and the D5 capacity/recovery tests. Phase 4 implementation is present, but its independent second cryptographic review/sign-off and the release revision must still be recorded before production approval. Existing pre-v2 records and clients are intentionally outside the supported cutover.
