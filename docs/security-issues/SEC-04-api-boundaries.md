# SEC-04: Validate payloads, prevent API caching, and keep sensitive data out of logs

**Priority:** P1.
**Status:** Repository implementation complete with in-house security-header hooks; edge and release evidence remain pending.
**Tracking:** [GitHub issue #4](https://github.com/atas-tech/blinddrop/issues/4).
**Blocked by:** SEC-01's test environment and live edge verification; no new middleware dependency was added.

**Implementation detail:** [Phase 3: Abuse controls, boundary validation, deployment hardening](../security-review-2026-09-11.md#phase-3-abuse-controls-boundary-validation-deployment-hardening), including schemas, response headers, logging and deployment checks.

## Problem and intended behavior

Request bodies are cast to `any`, TTL errors silently default, payload encoding is minimally checked, and secret responses have no explicit no-store policy. Request logs can expose IDs through URLs. The client trims secrets and spreads potentially large byte arrays while encoding. Validation must reject malformed data without changing valid secret content or leaking sensitive fields.

## Scope

- Reuse SEC-01's route parameter validation; do not defer the auxiliary-key fix to this issue.
- Use existing Fastify schemas for bodies: reject malformed/null bodies, unknown fields, unsupported TTLs, and invalid v2 payload/salt encodings and sizes. Keep the request aligned with the selected v2 envelope and lifecycle formats.
- Enforce the intended 100 KiB UTF-8 plaintext limit before encryption; calculate an encoded-payload server limit that allows necessary IV/tag/JSON overhead. Use an encoding method that avoids argument-spread limits.
- Preserve leading/trailing whitespace and multiline secrets instead of trimming before encryption.
- Set `Cache-Control: no-store` on all secret API responses and errors, with matching fetch behavior. The hosting task owns edge cache bypass verification.
- Use the small Fastify reply hook for the API header baseline. It cannot set CSP/HSTS/frame headers on the separately hosted GitHub Pages frontend; those remain edge deployment requirements.
- Redact sensitive request/response fields and secret IDs in application/proxy logs; body-field redaction alone does not redact IDs embedded in logged URLs.
- Keep plaintext, passphrases, keys, access/burn tokens, and complete share links out of logs and telemetry. SEC-02 owns burn-token hashing and atomic lifecycle authorization.

## Dependency guardrail

Implementation chose a small Fastify reply hook for the API header baseline, so `@fastify/helmet` was not added and no manifest or lockfile dependency change was needed for this issue. A Socket review is therefore not applicable to the shipped implementation.

Compare maintained API-header middleware with a small Fastify reply hook and proxy headers. If selecting `@fastify/helmet`, obtain and report Socket findings for a compatible version, including install scripts, capabilities, and transitive risks, before editing package.json or lockfiles. Follow AGENTS.md decision outcomes. This is a candidate addition, not a completed safety review.

## Acceptance criteria / test names

Use `tests/integration/api-boundaries.test.ts` and `e2e/security-regressions.spec.ts` as appropriate:

- [ ] `malformed_null_or_unknown_body_fields_return_controlled_errors`.
- [ ] `unsupported_ttl_and_invalid_ciphertext_or_salt_are_rejected`.
- [ ] `utf8_plaintext_limit_accepts_100_kib_and_rejects_one_byte_more`.
- [ ] `whitespace_and_unicode_round_trip_without_changes`.
- [ ] `large_supported_payload_does_not_hit_argument_spread_limits`.
- [ ] `every_secret_response_including_errors_has_no_store`.
- [ ] `api_security_headers_match_the_selected_policy`.
- [ ] `synthetic_secrets_ids_and_tokens_are_absent_from_captured_logs`.
- [ ] `plaintext_passphrase_and_fragment_key_never_enter_api_requests`.

Header and logging checks at the real edge remain deployment acceptance work. An origin-only passing test does not establish the deployed policy.
