# State-authority sink campaign

This is the live orchestrator for a bounded adversarial campaign covering stale
or over-broad browsing-context authority. It is subordinate to the live roadmap,
issue #449, the security-program registries, and release gates. Every consequence
is synthetic, inert, loopback-only, and independently recorded by the typed fake
sink.

## Current checkpoint

| Slice | Scenario | Attack vector | Candidate state | Evidence ceiling |
| --- | --- | --- | --- | --- |
| RW-21 | `NS-ADV-WIN-005` | one trusted gesture is double-spent across two popup destinations | behavior proved on PR #681; PR #714 supplies raw committed-byte, index, undeclared-input, and fixed-output receipt authority pending final review | local bundled-Chromium regression |
| RW-24 | `NS-ADV-EVADE-003` | delayed time-bomb popup fires after gesture authority expires | behavior proved on PR #681; PR #714 supplies raw committed-byte, index, undeclared-input, and fixed-output receipt authority pending final review | one fixed timer boundary |
| RW-25 | `NS-ADV-STATE-008` | rapid popup close/reopen churn leaks stale authority to a final target | behavior proved on PR #681; PR #714 supplies raw committed-byte, index, undeclared-input, and fixed-output receipt authority pending final review | one authored churn ordering |

The Playwright spec emits non-authoritative candidates; only the exact committed launcher may finalize authoritative receipts for a run. Do not turn
this table into a manual pass claim: promotion requires immutable commit/tree
resolution, raw Git-blob versus filesystem-byte equality, exact index modes and
object IDs, zero undeclared or special build inputs, the fixed-output hash,
typed-sink observations, and all proving checks below. The lane rejects an
`EXTENSION_PATH` outside the current worktree, owns only ordinary
`extension/dist`, and rechecks source and output authority before attaching a
receipt. See [RAW_EVIDENCE_AUTHORITY_684.md](RAW_EVIDENCE_AUTHORITY_684.md).

## Adverse conditions and expected outcomes

The browser is deliberately launched with `--disable-popup-blocking`. This
removes Chromium's native popup shield from the model so an extension-disabled
attack baseline must reach the local harm sink. It is an adverse-condition model
using Playwright-bundled Chromium, not a statement about branded Chrome defaults.

| Arm | Condition | Required outcome |
| --- | --- | --- |
| Attack baseline | extension disabled; native popup blocking disabled | exactly one typed harm receipt (`HARM_REACHED`) |
| Protected attack | release extension loaded; native popup blocking disabled | zero harm receipts (`BLOCKED_PRE_HARM`) |
| Benign control | release extension loaded; native keyboard activation | exactly one benign receipt and zero harm receipts |
| Mixed | benign consequence and attack sequence share one fresh profile | benign consequence completes; harm receipt remains absent |

Every arm uses a fresh browser profile and a fresh sink with one-use target
authorities. The fixture cannot select a destination through query input. The
page-init bootstrap binds only the exact fixture origin and path, and the final
sink revalidates the run, scenario, role, consequence, target ID, use count, and
inert sentinel. A pre-launch proxy denies browser background egress; those denied
attempts are recorded separately from authored-fixture traffic.

## Qualification checklist

- [x] focused ESLint for the changed evidence files
- [x] `npm run typecheck`
- [x] raw-authority adversarial unit suite, including clean-filter and CRLF bypasses
- [x] ordinary and ignored untracked-input rejection
- [x] committed and worktree link rejection without traversal
- [x] stale-head, index-drift, missing-object, linked-worktree, and output-mutation coverage
- [x] test-owned current-head extension build and output recheck
- [x] exact-head RW-21/RW-24/RW-25 typed-harm campaign
- [ ] normal hosted CI on the pushed head
- [ ] one issue-scoped independent review of PR #714

PR #714 is stacked directly on PR #681 and supplies the bounded #684 closure.
Its publication gate runs the raw-authority unit suite and all three typed-harm
journeys against the exact candidate commit before pushing it. Merge remains
blocked on normal hosted CI and one issue-scoped independent review; broader
receipt migration stays separate from this state-authority slice.

Any missing attack-baseline receipt, any protected or mixed harm receipt, an
invalid sink request, a source/hash mismatch, or authored-fixture external
request is `TEST_INVALID` or a security failure—not a flaky pass. A survivor
downgrades the mapped evidence and parks the change for root-cause analysis.

## Explicit non-claims

This campaign does not prove branded-Chrome Gate-3 behavior, open-web efficacy,
real sleep/wake or calendar gating, service-worker suspension/restart, browser
crash/profile restart, randomized concurrency, every popup policy, or every
authority-token consumer. Issue #175 owns broader lifecycle recovery, while
#458 and #496 own browser-platform attribution boundaries.


## Review repair checkpoint

The initial raw-byte candidate passed its scoped campaign and ordinary Build /
Unit lane but independent review found three P1 receipt-authority gaps. Those
results remain development evidence only. The successor must pass corrupted
object, alternate-config, mixed-case Git environment and external-preflight
regressions, then rerun all three journeys on one exact commit and receive a
fresh review before #681 can become merge-eligible. Direct in-spec verification
is no longer an accepted launch route.

## Replay-resistance checkpoint

The successor review found that the first external-preflight token was reusable:
`--preflight-only` printed the complete unsigned attestation and the spec trusted
caller-supplied run identity. That result is superseded.

The qualifying launcher must now execute Playwright's config, spec, imported
helpers, and Gym fixtures from a private tree materialized directly from
authenticated Git blobs. The one-worker campaign consumes an HMAC-authenticated
attestation exactly once and repeatedly hashes the materialized source closure.
The diagnostic preflight command emits only a non-consumable summary. Direct
worktree loading is a required negative regression and cannot enumerate the
campaign tests.

Promotion still requires an exact-head hosted run of all three typed-harm
journeys and a fresh independent review of this repaired execution boundary.

## Launcher-owned final receipt checkpoint

Positive evidence is now a two-stage protocol. The committed campaign process
produces non-authoritative behavior candidates only. The exact committed launcher
keeps the finalization key outside the child, waits for a successful child exit,
revalidates source, materialized campaign, object store, and fixed build output,
then reconstructs and authenticates the final receipts itself. A caller-created
HMAC launch envelope cannot cross that boundary because the Playwright process
never receives the launcher finalization key and contains no final-receipt writer.

Qualification must retain the three launcher-finalized schema-5 receipts and the
launcher manifest as the evidence artifact. Candidate files are diagnostic input
and are deleted with the private launch directory.


## Node-floor and external-verification checkpoint

The exact launcher must execute with plain Node on the repository's supported
engine floor. It transpiles only the two authenticated TypeScript authority
helpers into a private runtime directory with the repository's installed
compiler, while every campaign/source hash continues to cover the original
committed TypeScript bytes.

Child environments remove all case variants of Git, state-authority, Node
preload/module-path, and extension-path variables. The launcher process itself
still trusts the external workflow or owner shell to clear Node preload authority
before Node starts; that pre-process boundary is explicit rather than silently
claimed by in-process cleanup.

Each finalized receipt is signed with a launcher-only Ed25519 key. The exact run
log publishes the public-key fingerprint and SPKI bytes, and the retained artifact
is verified against that independently bound fingerprint with
`scripts/verify-state-authority-receipts.mjs`. The internal HMAC remains only a
same-process/read-back control and is not presented as long-term artifact
authentication.

## Retained-set and default-runner boundary

The external verifier requires the trusted run's manifest SHA-256 before it will
parse or accept the retained set. It then enforces the exact unique journey set
`RW-21` / `RW-24` / `RW-25` and binds each canonical filename to the signed
journey and scenario fields.

`state-authority-sink.spec.ts` is excluded from ordinary Playwright collection.
It remains available only through `playwright.stress.config.ts` and the committed
launcher, so the default E2E lane neither bypasses the authority boundary nor
fails merely by importing a launcher-only module.
