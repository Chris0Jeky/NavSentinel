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

The executable receipt emitted by
`tests/e2e/state-authority-sink.spec.ts` is authoritative for a run. Do not turn
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
