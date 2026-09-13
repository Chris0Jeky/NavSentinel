# Monitor fault and frozen challenge qualification

Initial source snapshot: 2026-09-13, above #705 head
`3a43fab52ad41d6885c1b2ecc9fd125daaeb638f`.

## Reconciled state

The previously pending normal E2E job for #705 passed at 18:18:37 UTC on
2026-09-13 (run 34773397298, job 103767160205). The original #693 MutationObserver
fixture nondeterminism remains owned by #697. No unrelated test assertion or
extension behavior is changed in this continuation.

## Local results at the first candidate

Node 22.16.0, Linux, original lockfile dependencies from the previously downloaded
and SHA-256-verified development artifact. The reconstructed #705 source tree was
`5e633a8a689f4a6682c33a21026d46d61b093389`; baseline 108 contracts passed.

- 135 Observatory Node contracts passed, zero failures/skips. New tests first
  failed for missing fault timeline events, false confirmation from labels alone,
  missing matrix/argument validation, and intentional-fault prevention exclusion.
- Default repository suite: 3,286 tests / 118 files passed, no exclusions.
- Repository typecheck and lint passed.
- Interaction-only build and 12 budgets passed: 493.2 KiB / 500 KiB total.
- Research-reputation build and 13 budgets passed: 496.6 KiB / 500 KiB total.
- Playwright listed six fault tests and two challenge campaigns.
- Managed local Chromium refused navigation with ERR_BLOCKED_BY_ADMINISTRATOR.
  Its policies were not modified. Local browser execution is not claimed.

## Required hosted qualification

The dedicated read-only workflow executes the actual faults and both four-arm
challenge matrices. Each lane must be read on its exact head; source-only tests
or a prior campaign pass cannot substitute for browser execution of these drivers.
The PR receipt will link the actual run/artifact and preserve first-attempt failures.

Fault trial pass criteria: healthy baseline receiver and readiness; a deliberate
injection plus a distinct, corresponding browser/receiver/loss observation; a
visible negative-evidence gap; no prevention support. Page flood and receiver
observer-error trials use a genuinely harmful baseline arrival so positive harm
cannot be concealed by a successful test-system check. Faults are not added to
attack efficacy denominators as if they were ordinary protected trials.

The six drivers are receiver unavailable, primary frame removed, primary document
replaced, worker stopped/restarted, page-report flood, and secondary receiver
observer exception. Worker lifecycle control uses the experimental CDP ServiceWorker
domain in a disposable test profile. It requires observed stop, restart and loss of
the previous in-memory marker. Missing browser capability fails the trial; no skip
or synthetic marker is accepted as a substitute.

## Challenge boundary

Frozen before the first new browser qualification, without detector changes:
`narrow-reinsert-900` (840 x 760 viewport, 900 ms wait after readiness) and
`wide-reinsert-2600` (1520 x 1000, 2600 ms wait). The existing fixture's rewrite and
replacement timers are unchanged. Waits are relative to runner readiness, not
claims of exact scheduler time; recorded events show actual elapsed timing.

These are new timing/viewport combinations for an existing attack family, not a
newly collected malicious corpus or an independent external benchmark. After
inspection they become regression cases. Full/minimal agreement is a measured
consequence-vector check, not a statistical proof of zero observer effect.

## Not delivered in this slice

No live session recorder, permission, remote endpoint, feedback store, automatic
policy change or source-registry promotion. Child-form integration still requires
reconciliation with the open #698 defense branch. Synthetic receipt timing is a
collector observation, not cryptographic authenticity or real secret extraction.
The standalone source checker is still bounded campaign provenance, not a complete
solution of #684/#692 or dependency/supply-chain reproducibility.
