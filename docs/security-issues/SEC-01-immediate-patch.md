# SEC-01: Fix secret XSS and reject auxiliary-key IDs

**Priority:** P0; first patch this week.
**Status:** Implemented in the repository; automated verification requires the Redis/Playwright test environment.
**Tracking:** [GitHub issue #1](https://github.com/atas-tech/blinddrop/issues/1).
**Blocked by:** Nothing in the retrieval or hosting decision.

**Implementation detail:** [Phase 1: Immediate fixes](../security-review-2026-09-11.md#phase-1-immediate-fixes-single-pr-no-design-decisions-needed), including safe rendering, route validation and truthful deletion messaging. The test-harness requirements remain in this issue specification.

## Problem and intended behavior

`src/main.ts` interpolates decrypted secrets and API errors into HTML. A crafted secret can close the textarea and execute an event handler in the recipient's page. `server/app.ts` accepts arbitrary route IDs, allowing requests such as `/api/secrets/<uuid>:salt` to address and delete auxiliary Redis data. The former consume-acknowledgment behavior is documented as baseline history; the shipped v2 contract uses one atomic `/reveal` request and has no consume endpoint.

Group these small fixes into one patch. They correct immediate defects without changing the delivery contract.

## Scope

- Use textarea `.value` for plaintext and share links; use `.textContent` for API errors. Keep dynamic values out of HTML templates.
- Apply shared UUID parameter validation to every secret route before any Redis operation. Reject literal and URL-encoded auxiliary-key suffixes. Fastify schemas are sufficient; do not add a validation package.
- Use the SEC-02 at-most-once `/reveal` state model for deletion claims. Handle non-2xx, malformed responses, and network failure explicitly. Do not retry a destructive request automatically or claim that local decryption proves server deletion.
- Preserve click-to-reveal and local crypto. Do not block this patch on CSP hosting or the atomic-retrieval redesign.
- Establish the regression test entry points: repair the Playwright frontend/API harness, add a real-Redis integration harness with Node's test runner and the existing TypeScript runtime, define `test:integration`, replace the stub `npm test` with both suites, and run them in CI against disposable Redis and Chromium.
- Mock Turnstile verification only in explicit test setup. The current API-only test server returns JSON at `/`; tests must visit the actual frontend.

## Acceptance criteria / test names

Browser tests in `e2e/security-regressions.spec.ts`:

- [ ] `crafted_secret_is_rendered_literally_without_script_execution`: reveal an encrypted synthetic `</textarea><img src=x onerror=alert(1)>`; assert exact textarea value, no injected image, no dialog, and no injected request.
- [ ] `api_error_is_rendered_as_text`: test both metadata and reveal error rendering paths with HTML in the error string.
- [ ] `reveal_waits_for_user_click`: page load may request metadata but does not fetch the encrypted payload or consume it. Preserve the existing behavior.

Integration tests in `tests/integration/secret-routes.test.ts`:

- [ ] `invalid_secret_ids_are_rejected_on_every_route`: cover all ID-bearing endpoints and encoded/literal colon suffixes.
- [ ] `auxiliary_key_request_does_not_modify_redis`: create an isolated synthetic passphrase record, request `<uuid>:salt` / `<uuid>:burn` / `<uuid>:lock`, and assert rejection with original data intact.
- [ ] `valid_uuid_routes_remain_usable`: normal metadata/retrieval/burn behavior is not rejected by the guard.

Harness acceptance:

- [ ] `npm test` invokes the browser and integration suites rather than the stub; failures exit nonzero and test connections/processes are cleaned up.

## Boundaries

The coordinated release removes the former delivery paths through SEC-02. This patch does not install packages; Phase 4 separately defines the v2 crypto format. Test only against isolated synthetic data, never production.
