# Session URL inventory for #176

This is a source snapshot at `cebe78839e0659f33a97372070def1d3233e20c9`,
prepared for [#176](https://github.com/Chris0Jeky/NavSentinel/issues/176).
It records current producers, consumers and retention. It does not approve a
privacy boundary, change runtime behavior or close the issue. No live browsing
data or real OAuth secrets were inspected.

Chrome documents `storage.session` as memory retained while the extension is
loaded, cleared on disable, reload, update and browser restart. A service-worker
restart is a different boundary. Per-record expiry still depends on the code
below. [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage#session)
(checked 2026-10-02).

## Current URL-bearing stores

All manager keys below have the prefix `ns_sw:`. Numbers describe eligibility
checks, not a promise that an idle record is erased at that time. Source links
refer to the snapshot identified above.

| Key / field | Precision used by current consumers | Retention and removal |
| --- | --- | --- |
| `allowStarted[tabId]` | Full navigation URL; exact equality permits a slow commit whose navigation began inside an allow/gesture window. | No independent age check. Next before-navigation, relevant commit, history traversal, error or tab removal clears/replaces it. |
| `allowTarget[tabId].url` | Exact destination by default. Optional query-prefix mode still binds protocol, host, pathname and any specified fragment; the query must match or extend at an `&` boundary. | Default 10s, at most 30s. Eligibility checked against `expiresAt`; no timer erases it. Any top commit consumes it. Tab removal deletes it; hydration does not prune expired entries. |
| `allowTarget[tabId].silentEvent` | Normal capture producer emits hosts and factors without a URL. Accepted event shape can also contain `url`, arbitrary `extra`, and unknown fields; host-only persistence is not guaranteed for every admitted object. | Shares the allowance's lifetime. No separate event TTL or session scrub. Appended to the event log only on the approved commit. |
| `pendingRollback[tabId].url/prevUrl` | Blocked document freshness uses a fragment-stripped commit basis. The prior full URL supplies the actual `location.replace` return destination. | No timestamp or age check. Successful delivery deletes the same pending object; failure retains it. Unrelated navigation/error and tab removal clear it. |
| `pendingForward[tabId].url/returnUrl` | Exact destination/return comparisons bind the retry offer; content uses fragment-stripped return freshness. The full destination supplies retry navigation. | The 6s check is conditional: already-on-destination, matching-return and missing-return branches run before it. Update-time push does not check age. Successful delivery deletes; failure retains. Unrelated navigation/error and tab removal clear it. |
| `rollbackReturn[tabId].url` | Exact before-navigation equality preserves the intended forward offer during a rollback. | 5s eligibility checked on read; an expired read deletes and persists. No timer. Top commit, unrelated navigation/error and tab removal clear it. |
| `lastUrl[tabId]` | Full current/prior baseline. Exact comparison prevents stale context overwrites; copied full target enables return navigation. Some classification uses only registrable domains. | No age. Replaced by a new baseline/commit; tab removal deletes it. Ordinary before-navigation/error helpers do not clear it. |
| `lastCommitted[tabId].url/prevUrl` | Full commit and prior URL returned to rollback polling. `allowedAtCommit` plus `ts` also supports recent user-context inference. | `ts` limits user-context eligibility, not stored-record lifetime or rollback polling. Pending-state clearing, history, selected benign commits and tab removal delete it. No general age prune. |
| `redirectChains[tabId].hops[].url` | Classifier reads hostname, pathname and query parameter **names**. Query values and fragments remain stored but are not read by this classifier. | Chain extension window 10s; age prune at 15s from last retained hop during `recordHop`/`getChainInfo`; maximum 10 hops and 100 tabs. Typed/history boundaries clear. Read-prune changes memory without immediately persisting that deletion. |
| `oauthFlow[tabId].expectedCallbackDomain` | Current producers derive a normalized hostname from the redirect URI; mismatch comparison uses registrable domains. Producer record also contains `startedAt` and `phase`, with no full URL field. | Other-tab pruning on authorization navigation uses 60s age and a 50-entry cap; the active tab is exempt. Completion and tab removal delete. Content's 60s read expiry does not itself erase the worker's stored record. |
| Separate `pendingDecision` v2 records | Full URLs are SHA-256-hashed for exact context/destination binding; stored origins retain scheme/host/port. The reconstructed URL fields are origins/hashes rather than raw full destinations. | 30s eligibility; hydration drops expired/malformed records and awaits a sanitized write. Listing/consumption removes expired records; navigation and tab removal perform awaited cleanup. No idle timer. |

Manager field definitions and persistence:
[session_state.ts](../../extension/src/shared/session_state.ts#L36).
Navigation producers/consumers:
[sw.ts](../../extension/src/sw/sw.ts#L759),
[allow-target matching](../../extension/src/sw/sw.ts#L1293),
[forward polling](../../extension/src/sw/sw.ts#L947),
[commit state](../../extension/src/sw/sw.ts#L1115),
[update-time delivery](../../extension/src/sw/sw.ts#L1447).
Content return/freshness behavior:
[capture_isolated.ts](../../extension/src/content/capture_isolated.ts#L1287).
Silent-event producer and admitted schema:
[capture builder](../../extension/src/content/capture_isolated.ts#L832),
[storage_impl.ts](../../extension/src/shared/storage_impl.ts#L753).
Redirect classifier/pruning:
[redirect_chain.ts](../../extension/src/shared/redirect_chain.ts#L123).
OAuth producer/pruning:
[sw.ts](../../extension/src/sw/sw.ts#L213),
[OAuth helpers](../../extension/src/content/oauth_monitor.ts#L36).
Pending-decision reconstruction/hashing:
[pending_decision.ts](../../extension/src/shared/pending_decision.ts#L388),
[store](../../extension/src/sw/pending_decision_store.ts#L94).

## Hydration and restart limits

`SessionStateManager` restores validated **original objects**, including unknown
properties; it is not a reconstruction whitelist. Its OAuth validator requires a
string `expectedCallbackDomain`, not a hostname-only value. Current domain-only
producers therefore do not establish that every admitted or restored OAuth record
is domain-only. The same distinction applies to `silentEvent` and redirect-chain
objects. Hydration does not prune valid records by age.
[validators](../../extension/src/shared/session_state.ts#L150),
[original-object restore](../../extension/src/shared/session_state.ts#L407).

Hydration retries a failed read once. After both reads fail, handlers can run
against memory, but writes remain suppressed for that worker's lifetime so an
empty cache does not overwrite unread session state. The next worker startup can
hydrate again. Persistence is fire-and-forget and can fail; tab deletion removes
all manager maps before a batch write. The separate pending-decision store awaits
its reconstruction/cleanup writes.
[manager hydration/persistence](../../extension/src/shared/session_state.ts#L286),
[pending-decision hydration](../../extension/src/sw/pending_decision_store.ts#L173).

`ns-get-chain-info` can prune the backing redirect map without persisting it. A
subsequent worker can restore the still-stored chain until another write/cleanup
reconciles it. Likewise, conditional forward expiry and no-age rollback/baseline
records cannot be described as bounded physical idle retention.
[chain read](../../extension/src/sw/sw.ts#L976),
[forward branches](../../extension/src/sw/sw.ts#L947).

## Existing proof and remaining gaps

Existing manager tests simulate serialization/hydration and invalid-shape
rejection. Rollback tests cover slow starts, destination binding, pending
delivery, failure retention and navigation boundaries. Redirect tests cover
chain windows/pruning. OAuth tests cover producer domain extraction, callback
completion, mismatch gating and active-tab prune exemptions. Pending-decision
tests cover expiry, context hashes and awaited lifecycle cleanup.

These are focused executable contracts, not proof of actual browser worker
recycling or an approved data boundary. The principal gaps found in this read are:

- exact query/fragment distinctions across restart followed by real return/retry;
- idle physical deletion versus read-time ineligibility;
- expired matching-return, missing-return and update-push forward cases;
- chain read-prune followed by a second worker restoring session storage;
- admitted extra-field/silent-event URL preservation and projection behavior;
- an OAuth record seeded before hydration followed by mismatch processing.

Test seams:
[session-state](../../tests/session-state.test.ts#L463),
[tab-key validation](../../tests/session-state-tabkeys.test.ts),
[rollback](../../tests/sw-rollback.test.ts#L840),
[content freshness](../../tests/rollback-staleness.test.ts#L26),
[redirect chains](../../tests/redirect-chain.test.ts#L176),
[OAuth](../../tests/oauth-monitor.test.ts),
[worker OAuth](../../tests/sw-handlers.test.ts#L1643),
[pending-decision store](../../tests/pending-decision-store.test.ts#L140).

At this snapshot, eight focused suites passed with 361 tests: session-state,
tab-key validation, worker rollback, redirect chains, pending-decision store and
handlers, OAuth monitor and worker handlers. All 29 relative source/test links
were checked for existing targets. No real worker-kill, idle-erasure or proposed
minimization-equivalence experiment was run.

## Decisions still open in #176

Choose representation and lifetime per correctness purpose. Exact return/retry
destinations and exact-context grants need a different analysis from a classifier
that reads only host/path/query keys. Moving a full target to worker memory also
changes restart behavior; that tradeoff needs an explicit decision and regression
proof.

Record whether physical idle retention must be bounded, whether the existing
conditional forward expiry/no-age rollback and baseline records are intentional,
and which restored/embedded event fields are admitted. These are unresolved
questions in #176, not approvals inferred here.

[#474](https://github.com/Chris0Jeky/NavSentinel/issues/474) remains a separate
owner reset-boundary decision: current behavioral reset covers outcomes, adaptive
scores, event log and domain profiles, while session navigation/pending decisions
remain outside it. No user configuration or session data was deleted.
[reset lanes](../../extension/src/shared/behavioural_reset.ts#L47).

`ACTION_ITEMS.md` remains the human queue; AI-19 is the current cursor. This
inventory does not claim a human Gate-3 pass or close either owner decision.
