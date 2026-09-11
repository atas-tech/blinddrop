# SEC-02: Enforce the v2 retrieval contract and clean up secret records

**Priority:** P0.
**Status:** Repository implementation complete; coordinated v2 cutover and release evidence remain pending.
**Tracking:** [GitHub issue #2](https://github.com/atas-tech/blinddrop/issues/2).
**Blocked by:** At-most-once release evidence and the product decision to break pre-v2 clients. Uses the SEC-01 test harness.

**Implementation detail:** [Phase 2: Single retrieval contract](../security-review-2026-09-11.md#phase-2-single-retrieval-contract-one-api-pr-one-frontend-pr-coordinated-release), with the v2-only cutover policy documented there.

## Problem and intended behavior

The baseline `/access` and `/consume` reservation flow exposed ciphertext before deletion, allowed redelivery after a lease expired, and left multiple auxiliary Redis keys. A generic retrieval route also made those keys addressable through crafted IDs. This issue replaces that model with one atomic payload-delivery operation.

The contract is at-most-once server delivery: one request can obtain the encrypted envelope, and a lost response can lose the secret. No server can prevent a recipient from saving or viewing a delivered copy repeatedly.

## Implemented scope: v2-only at-most-once contract

- Preserve the click-to-reveal gate and non-consuming metadata request.
- Expose only `POST /api/secrets/:id/reveal` for payload delivery. The former `GET`, `/access`, and `/consume` paths are not registered and return a generic `404` without reading or mutating state.
- Store each new secret as one Redis hash (`v`, `ciphertext`, optional `salt`, `burn_hash`) with one TTL. Keep only a bounded `<id>:status` tombstone after reveal or burn.
- Authorize early burn and perform deletion atomically with reveal. An unauthorized burn cannot win the race or modify state.
- Return the complete v2 encrypted envelope and optional salt in the one reveal response. Keep it in recipient-tab memory for wrong-passphrase retries; never re-fetch on retry.
- Surface response-loss uncertainty accurately; a transport failure is not a successful deletion claim.
- Do not deliver, burn, convert, extend, or otherwise support pre-v2 records. There is no migration reader, drain, redirect, or compatibility route. Operators may allow old records to expire or remove them through a separately approved operational procedure.

## Acceptance criteria / test names

Use `tests/integration/secret-lifecycle.test.ts`, an isolated real Redis, actual Lua operations, and concurrent Fastify requests:

- [ ] `concurrent_reveals_deliver_ciphertext_at_most_once`: no more than one request obtains a payload.
- [ ] `reveal_vs_burn_has_one_atomic_winner`: a burn winner prevents delivery, and a reveal winner is the only request that receives ciphertext.
- [ ] `unauthorized_burn_cannot_change_live_state`: incorrect authorization cannot delete the record or alter terminal status.
- [ ] `terminal_operations_leave_only_the_tombstone`: reveal/burn leaves only the bounded status tombstone.
- [ ] `get_head_and_metadata_do_not_deliver_or_consume`: metadata remains available while alternate payload delivery is absent.
- [ ] `deprecated_retrieval_routes_are_removed`: old paths return generic `404` with no payload and no state change.
- [ ] `pre_v2_string_records_are_not_delivered_or_converted`: old string and hash records are not revealed, burned, converted, or given a new TTL.

Browser tests in `e2e/passphrase-flow.spec.ts` cover `wrong_passphrase_retry_reuses_only_local_ciphertext` and `lost_reveal_response_does_not_claim_successful_view`.

The release record must identify the v2-only cutover revision and explicitly accept that pre-v2 clients and records are unsupported. Mock Redis implementations do not satisfy the concurrency criteria.
