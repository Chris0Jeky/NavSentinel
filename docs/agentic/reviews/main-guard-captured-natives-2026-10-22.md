# MAIN-world captured-native security fixes

Base: `ff7f684b1ba3fc7524665e2226e422c635b38799` (`origin/main` at task start).
Branch: `fix/main-guard-captured-natives`. Changes are local and uncommitted.

## Finding status and failing-first evidence

| Finding | Baseline unit reproduction | Baseline Chromium reproduction | Fixed result |
| --- | --- | --- | --- |
| Genuine bridge port exposed through mutable `postMessage` | Real MAIN module/verified bridge: interception count **1**, expected **0**. The interceptor sent both attacker-shaped message types through the genuine port. | Prototype interceptor captured **2** genuine sends, expected **0**. Local fixture destinations only. | Same real-module test and Chromium probe pass with zero captures. Captured post/start/close/onmessage setter, MessageEvent data/source/ports getters, and the bridge's listener registration avoid calling page replacements with private bridge objects. |
| Mutable lowercasing turns `_top` into `_self` | Real MAIN module/child-frame model: native form-submit spy called **1** time, expected **0**. | Local dummy credential sink received **1** child-to-top POST, expected **0**. | Same unit test and Chromium probe pass with no native submit/sink request; a blocked-form warning is attached. |

The baseline unit command was:

```powershell
npx --no-install vitest run tests/main-guard-dispatch-contract.test.ts tests/main-guard-bridge-handshake.test.ts
```

It reported **2 failed, 20 passed** before production edits. Browser probes ran
against the baseline build before rebuilding the edited source, with
`CI=1`, `--grep 'prototype postMessage|lowercase tampering'`, and `--retries=0`:
**2 failed** on their attack assertions.

## Implementation and bounded sweep

The MAIN loader imports asynchronously, so module-time captures alone leave a
page-script race. Its existing synchronous `document_start` prelude now installs
an immutable native-invoker record. MAIN requires that record; it never falls
back to capturing page APIs after the async gap. Captured native call invokers
also avoid later `Function.prototype.call` or `Reflect.apply` replacements.

Decision paths now use captured lowercase/trim/includes/startsWith operations,
URL construction and URL getters, numeric predicates, RegExp exec, Map/WeakSet
operations, and array operations. Splitting and HTML-whitespace stripping avoid
page-overridable symbol dispatch; timestamp pruning and gesture-budget
bookkeeping avoid mutable Array methods. Shared URL/anchor helpers use the early
record in MAIN and retain their normal trusted-world behavior elsewhere. The
outbound queue captures its native array/classification operations and drains
messages without a mutable `map` call. Queue flushing and path scanning use
indexed iteration.

The isolated receiver's `ns-allow-target-nav` policy is unchanged. A fresh
trusted gesture alone is not a sufficient replacement for its current protocol:
MAIN legitimately announces off-mode navigation, deferred approved navigation,
and child self-navigation. Binding authority to an isolated-world decision ID,
destination and lifetime needs a separate protocol/compatibility change. This
patch closes the demonstrated genuine-port interception path without silently
changing those allowances.

Remaining mutable surfaces observed in the sweep (not a claim of complete
hostile-realm hardening):

- `generateChallenge`: crypto/Uint8Array, `Array.from`, number-to-string,
  `padStart` and `join`; handshake timers, the `MessagePort` constructor/type
  check, and init/session authentication remain separate bridge lifecycle and
  availability concerns. Existing source tracks init-auth limitations under #186.
- DOM/event heuristics: `closest`, element attributes/target reads outside the
  captured form readers, layout/style queries, TreeWalker/Text methods,
  `composedPath`, `getRootNode`, and DOM constructors/type checks remain mutable.
  The existing anchor-intent comment identifies remaining MAIN event/path
  spoofing under #896. These need a separate DOM/gesture hardening review.
- Other form/DOM native captures still occur at module evaluation, including
  FormData/replay and some event/anchor getters. This change does not move every
  native in the module into the loader.
- Clipboard-item `types.includes`, promise/item/blob methods and selection
  stringification affect signal metadata. Opener/Location proxy reflection,
  method binding and cache operations remain mutable observation/compatibility
  surfaces; they do not grant the two demonstrated exemptions.

## Verification

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS, exit 0 |
| `npm run lint` | PASS, exit 0; 10 existing `no-explicit-any` warnings in unchanged observatory tests |
| `npx --no-install vitest run main-guard bridge form-target-self-exemption form-attribute-capture main-base-uri-loader-contract main-clock-loader-contract content-loader-contract form-child-replay-helpers redirect-allowance-exhaustion allow-once-url-scope` | PASS: **28 files, 297 tests**; includes both requested handshake suites |
| `npm run build` | PASS, interaction-only profile; release-profile, loader identity and static-worker checks also pass |
| `npm run check:perf-budget` | FAIL: MAIN **22,007 bytes** against **21,504**; all other asset/total budgets pass |
| `npm run check:content-loader` | PASS; UI guard revision `3cba6a730eef` |
| `CI=1 npx --no-install playwright test tests/e2e/bridge-peer-takeover.spec.ts --retries=0` with browser-launch diagnostics | PASS: **5 tests**, 58.6 s, Chromium **143.0.7499.4**; ten fresh profiles ready, zero peer challenges/acks/harm receipts and zero fixture network violations |
| `CI=1 npx --no-install playwright test tests/e2e/form-submit-child-authority.spec.ts tests/e2e/form-submit-child-replay.spec.ts tests/e2e/form-submit-gesture-task.spec.ts tests/e2e/form-submit-unmatched-replay.spec.ts` | PASS: **24 tests**, 2.3 min; includes native GET/multipart POST payload preservation, genuine/forged gesture controls and child-to-top/blank retarget/replay attempts |

The first full bridge invocation with default CI retries timed out its
ten-profile test at 90 seconds twice and was interrupted. The cause was not
established; this is retained as an unresolved run-level limitation, not labelled
flaky or repaired. A separate benign diagnostic passed in 3.0 s, and the fresh
full run above passed without retries or timeout changes (ten-profile case:
47.1 s).

Two stopped profiles from the interrupted run remain under the ignored
`test-results/bridge-profiles` directory: `navsentinel-186-attack-dasuQG` and
`navsentinel-186-attack-N1AGW3`. A process check found no Chrome using them;
automatic execution policy rejected their confined cleanup as "blocked by
policy". No deletion workaround or escalation was attempted.

The browser probes and existing form-submit specs use the existing local egress
fence before launching Chromium. Browser background external attempts are
denied by that proxy; fixture traffic and dummy credential sinks are loopback
only. Form-spec temporary profiles are confined to `test-results/runtime-temp`
via process-local TEMP/TMP settings. The bridge spec directly keeps profiles
under `test-results/bridge-profiles`.

## Size and release boundary

- MAIN: **21,484 -> 22,007 bytes**, exact delta **+523 bytes**; **503 bytes over**
  the unchanged 21 KiB cap. Bundle: `extension/dist/assets/main_guard.ts-BzpxkvpI.js`.
  SHA-256: `4354cc3fb941fd12f30dd2221d75bbdc01b97f09c4b6051ad29a0da22a48d51d`.
- The added early-capture block is **2,020 bytes**; the final MAIN loader is
  **3,350 bytes**. Loader stubs are excluded by the existing per-MAIN budget and
  remain included by the aggregate dist budget. The capture overhead is real.
- No budget was increased. A PR must wait for an owner budget decision.
- Shipped MAIN-world behavior changes, so Gate-3 applies. Automated temporary
  Chromium profiles are not a human browser result. No existing unpacked
  extension was loaded/reloaded by the agent.
- Human-action queue: [ACTION_ITEMS.md](../../../ACTION_ITEMS.md); cursor AI-19
  remains unchanged. No human decision or browser result was inferred.
- No dependency installation, Git write, commit, push, GitHub call or remote
  service call was performed.

Intended commit message: `fix: capture MAIN-world bridge and decision natives at document start`
