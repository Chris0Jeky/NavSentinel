# MAIN-world captured-native security fixes

Base: `ff7f684b1ba3fc7524665e2226e422c635b38799` (`origin/main` at task start).
Branch: `fix/main-guard-captured-natives`, PR #1141. The initial fixes are
committed at `155aaed23d25dac3ef40c1f6ad7a424e5d44d8e5`.
The deep-review follow-up described below is a local, uncommitted diff on that
head; this confined session does not perform Git writes.

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
operations. Capturing Array methods alone was insufficient: native `splice`
still invokes page-controlled species, and native `push` and indexed assignment
still invoke inherited setters. The follow-up uses a captured
`Reflect.defineProperty` to create own array data properties. Splitting avoids
symbol dispatch and returns `[s]` for an empty separator. Timestamp pruning and
gesture bookkeeping use the own-property append operation. Shared helpers and
the outbound queue receive MAIN invokers explicitly; isolated-world callers use
their own trusted natives without reading a page-named global. Queue removal and
drain use indexed own-element reads and length truncation, avoiding species.
Queue flushing and path scanning use indexed iteration.

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

## Initial-commit verification (historical)

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

## Deep-review follow-up on 155aaed2

| Item | Red evidence before the production changes | Green evidence |
| --- | --- | --- |
| HIGH: isolated-world Window named-property clobbering | Unit queue admission throws `TypeError: push is not a function`. The original module also throws `SecurityError` when the named-property read throws. Baseline Chromium: normal control passes; initial form markup reaches readiness but produces no navigation-block warning; initial cross-origin named iframe leaves capture/bridge markers missing. Final failing-first browser run: **2 failed, 1 passed**. | MAIN injects the queue's captured property definer and the classifiers' invokers. Shared modules never read the MAIN native global. Chromium normal/form/iframe cases all receive config, block cross-site `window.open`, and record **zero sink requests**. |
| MEDIUM: native Array species and inherited index setters | Initial unit run fails the species-forged drain assertion, inherited-setter queue admission/coalescing, and split/pruning/gesture bookkeeping assertions. | The queue creates own data properties, compacts by indexed reads, and clears its length after drain; it never calls `splice`. The prelude's append and split use captured `Reflect.defineProperty`. Unit coverage poisons species before enqueue/flush and index accessors before queue/decision calls; genuine bridge flush retains the original message and never invokes species. |
| LOW: empty-separator infinite loop | The original HEAD prelude's `split('abc', '')` reaches `ERR_SCRIPT_EXECUTION_TIMEOUT` with a 250 ms VM bound. | The prelude returns `['abc']`; the bounded regression passes. |
| Review record | The committed record still said local/uncommitted and overstated captured Array safety. | Commit status is corrected above; array semantics, follow-up evidence, and final byte counts are explicit. |

The named-property browser spec uses parser-created first HTML, never a script
assignment to the global. It delays the isolated import until that markup and
the cross-origin loopback frame exist, and delays MAIN import until isolated
settings initialization attempts to enqueue config. This makes the form case
exercise the vulnerable pre-handshake path rather than pass through an already
verified port. Both origins and the attempted navigation sink are loopback;
the deny proxy is installed before Chromium launches.

Commands below ran sequentially, with one heavy command at a time and no
dependency installation:

| Command | Follow-up result |
| --- | --- |
| `npm run typecheck` | PASS, exit 0 |
| `npm run lint` | PASS, exit 0; the same 10 warnings in unchanged observatory tests |
| `npx --no-install vitest run tests/main-guard-captured-natives.test.ts tests/main-guard-bridge.test.ts tests/main-guard-bridge-handshake.test.ts tests/main-guard-helpers.test.ts tests/bridge-outbound.test.ts tests/main-guard-dispatch-contract.test.ts tests/main-clock-loader-contract.test.ts tests/main-base-uri-loader-contract.test.ts tests/content-loader-contract.test.ts tests/redirect-allowance-exhaustion.test.ts tests/main-guard-redirect-allowance.test.ts tests/main-guard-anchor-open-intent.test.ts` | PASS, exit 0: **12 files, 164 tests** |
| `npm run build` | PASS, exit 0; interaction-only release profile, loader identity, and static-worker checks pass |
| `npm run check:content-loader` | PASS, exit 0; UI guard revision `e2c580da6faf` |
| `npm run check:perf-budget` | FAIL, exit 1: MAIN **21,916 / 21,504 bytes**; all other entries pass |
| `CI=1 npx --no-install playwright test tests/e2e/bridge-peer-takeover.spec.ts tests/e2e/bridge-named-properties.spec.ts` | PASS, exit 0: **8 tests**, 56.9 s; no retries needed |

Run diagnostics: the first unit attempt stopped before collection because my
script edit introduced CRLF in `content-loader-contract.mjs`; restoring LF fixed
the actual checkout check, without Git writes or guard changes. An initial
headless browser attempt timed out all three cases, including the normal
control; that was invalid vulnerability evidence. Matching the existing headed
harness produced the baseline red and final green above. The first headed form
probe passed when the bridge beat settings initialization; explicitly delaying
MAIN import made the queue-path regression deterministic. None of these are
classified as product flakiness.
The three `named-properties-*` profiles left by the headless timeouts were
removed after verifying that no Chrome process referenced their exact paths;
no named-property test profiles remain. Older unrelated profiles were preserved.

## Size and release boundary

- MAIN: original base **21,484**, committed HEAD **22,007**, follow-up
  **21,916 bytes**. Follow-up delta **-91 bytes**; total base delta **+432 bytes**;
  **412 bytes over** the unchanged 21 KiB cap.
  Bundle: `extension/dist/assets/main_guard.ts-9wpof186.js`.
  SHA-256: `a69ecac2bf0054364669dfd5bf5d31f9792596e657c8dbf69c06d1bd83ce7791`.
- The early-native capture block is **2,073 bytes** (was 2,020); the final MAIN
  loader is **3,403 bytes** (was 3,350): each grows **53 bytes**. Loader stubs are
  excluded by the per-MAIN budget and included in the aggregate dist budget.
  The shared outbound chunk is **2,340 bytes**; the MAIN delta is not a claim
  about the size of its entire dependency graph.
- No budget was increased. A PR must wait for an owner budget decision.
- Shipped MAIN-world behavior changes, so Gate-3 applies. Automated temporary
  Chromium profiles are not a human browser result. No existing unpacked
  extension was loaded/reloaded by the agent.
- Human-action queue: [ACTION_ITEMS.md](../../../ACTION_ITEMS.md); cursor AI-19
  remains unchanged. No human decision or browser result was inferred.
- No dependency installation, Git write, commit, push, GitHub call or remote
  service call was performed.

Intended additional commit message: `fix: isolate bridge natives and avoid array species and setters`
