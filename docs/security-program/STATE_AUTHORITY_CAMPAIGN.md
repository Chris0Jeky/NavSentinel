# State-authority sink campaign

This is the live orchestrator for a bounded adversarial campaign covering stale
or over-broad browsing-context authority. It is subordinate to the live roadmap,
issue #449, the security-program registries, and release gates. Every consequence
is synthetic, inert, loopback-only, and independently recorded by the typed fake
sink.

## Current checkpoint

| Slice | Scenario | Attack vector | Candidate state | Evidence ceiling |
| --- | --- | --- | --- | --- |
| RW-21 | `NS-ADV-WIN-005` | one trusted gesture is double-spent across two popup destinations | exact-source head `b4d0b44bab1dc759a63d3f04c89220563ec7f2ae` passed once plus three repeats; review/CI pending | local bundled-Chromium regression |
| RW-24 | `NS-ADV-EVADE-003` | delayed time-bomb popup fires after gesture authority expires | exact-source head `b4d0b44bab1dc759a63d3f04c89220563ec7f2ae` passed once plus three repeats; review/CI pending | one fixed timer boundary |
| RW-25 | `NS-ADV-STATE-008` | rapid popup close/reopen churn leaks stale authority to a final target | exact-source head `b4d0b44bab1dc759a63d3f04c89220563ec7f2ae` passed once plus three repeats; review/CI pending | one authored churn ordering |

The executable receipt emitted by
`tests/e2e/state-authority-sink.spec.ts` is authoritative for a run. Do not turn
this table into a manual pass claim: promotion requires the exact-head source
hash assertion, build hash, typed sink observations, and all proving checks
below.

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

- [x] `npm run typecheck`
- [x] focused ESLint for the changed test files
- [x] `npm run test -- --run tests/gym-local-fixture-contract.test.ts`
- [x] `npm run build`
- [x] one exact-source-head focused campaign run
- [x] one exact-source-head three-repeat campaign run
- [x] legacy RW-21/RW-24/RW-25 stress regressions
- [x] `npm run security:check` after registry promotion
- [ ] fresh-context adversarial review
- [ ] hosted CI on the pushed head

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
