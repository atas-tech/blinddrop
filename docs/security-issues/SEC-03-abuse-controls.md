# SEC-03: Fail closed on production Turnstile configuration and enforce rate limits

**Priority:** P1.
**Status:** Repository implementation complete with in-house Redis/Fastify primitives; deployment evidence remains pending.
**Tracking:** [GitHub issue #3](https://github.com/atas-tech/blinddrop/issues/3).
**Blocked by:** Production deployment and capacity evidence; no new package was added.

**Implementation detail:** [Phase 3: Abuse controls, boundary validation, deployment hardening](../security-review-2026-09-11.md#phase-3-abuse-controls-boundary-validation-deployment-hardening), including production configuration, in-house Redis limiter integration, capacity-policy confirmation and failure tests.

## Problem and intended behavior

`server/config.ts` falls back to Cloudflare's always-pass test secret even in production. Compose does not supply a production key. Rate-limit settings are unused. Production creation must reject unsafe configuration and enforce request limits before unbounded verification/storage work.

## Scope

- Fail production startup for absent or known testing Turnstile secrets; require the intended frontend site key for production builds. Restrict bypasses to explicit development/test configuration.
- Validate challenge success, expected hostname, and action when configured; bound verification time and fail closed on provider failure.
- Use the existing Redis client for shared enforcement. Set separate limits for creation and relevant read/burn operations, with consistent Redis-backed counters and controlled 429 responses.
- Trust client-IP forwarding only from configured reverse proxies and restrict direct origin access. Arbitrary forwarded headers must not supply fresh rate-limit identities.
- Require an explicit production CORS allowlist; do not treat CORS as authentication.
- Handle limiter/datastore failures deliberately instead of silently permitting unlimited creation.

## Dependency guardrail

Implementation chose the existing Redis client and Fastify hooks, so `@fastify/rate-limit` was not added and no manifest or lockfile dependency change was needed for this issue. A Socket review is therefore not applicable to the shipped implementation.

Before editing manifests or lockfiles, compare the plugin with native Redis counters and existing edge controls, select a Fastify-compatible version, and obtain/report Socket findings, install scripts, risky capabilities, and transitive risks under AGENTS.md. This issue names a candidate, not a safety-approved dependency. Respect Allow / warning / manual-review outcomes. No package installation is part of issue creation.

## Acceptance criteria / test names

Use `tests/integration/abuse-controls.test.ts` and explicit production-config checks:

- [ ] `production_rejects_missing_or_test_turnstile_secret`.
- [ ] `production_frontend_requires_turnstile_site_key`.
- [ ] `invalid_or_timed_out_turnstile_verification_rejects_creation`.
- [ ] `unexpected_turnstile_hostname_or_action_is_rejected`.
- [ ] `creation_limit_returns_429_before_excess_verification_work`.
- [ ] `rate_limit_is_shared_across_api_instances`: independent app instances use the same isolated real Redis counters.
- [ ] `spoofed_forwarded_ip_does_not_bypass_limits`.
- [ ] `independent_clients_remain_usable_within_limits`.
- [ ] `limiter_failure_does_not_silently_allow_unlimited_creation`.

Record the dependency decision and exact package version alongside implementation evidence. Do not weaken production behavior to make tests pass.
