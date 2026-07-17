# Session Handoff — NavSentinel

**Last updated:** 2026-07-17. Always refresh git/GitHub truth before acting.
`ACTION_ITEMS.md` holds the live human-facing snapshot without pinning a SHA;
the posture review's dated exact baseline is in `docs/Product_Strategy.md`.

This is the short next-loop entry point. Product direction is in
`docs/Product_Strategy.md`; execution gates are in `docs/Project_Roadmap.md`;
standing decisions are in `docs/agentic/DECISIONS.md`; human-only work is in
`ACTION_ITEMS.md`; historical cycle detail remains in `ORCHESTRATOR.md` pending
rotation under #437.

## Clean-stop checkpoint — 2026-07-17

- Root `main` is clean at `2888483` and matches `origin/main`.
- PR #356 exact head `f8028c9` is twice independently reviewed, Codex-clean,
  thread-clean, and green in GitHub run `29560572081`; AI-13 is the only
  remaining gate.
- PR #466 exact runtime head `0266107` is twice independently reviewed,
  Codex-clean, 4/4 thread-resolved, and green in run `29561311422`; AI-22 is the
  only remaining gate. No merge is authorized.
- PR #464 runtime `8aee243` removes service-worker pointerdown authority while
  retaining only the top-frame rollback baseline. Resumed independent round 1
  found a remaining medium MAIN-world path: smart mode still armed one popup
  directly on pointerdown. `a14f70d` now requires a trusted click and adds a
  Chromium negative/positive control that fails on the vulnerable mutation.
  Round 2 then found Navigation Off's programmatic bypass had been lost;
  `f824381` restores the explicit Off behavior without weakening enforcing
  modes, again with pre-fix-failing Chromium proof. Fresh final-head review then
  found that child-frame pointerdown could not seed a cold worker's top-tab
  rollback baseline. `e26dba9` accepts the non-authorizing context signal from
  any content-script frame while trusting only Chrome's `sender.tab.url`, with
  a pre-fix-failing child-frame Chromium control. Re-review on `d887270` found a
  delayed context could rewind a newer commit and the browser control did not
  deterministically create a cold worker. `7a9243a` adds live-tab/generation
  revalidation, deterministic missing/stale integration sequencing, and honest
  browser-proof scope. Review on `0475c6a` found the special second-read branch
  still lacked mutation-sensitive proof; `716a60e` now holds the first read
  across an intervening commit and fails when the second read is removed. The
  final documentation head must receive fresh round-2, Codex/thread, and CI
  evidence before AI-21 becomes actionable.
- The only dirty worktree is the known Defender-quarantined checkpoint at
  `C:/Users/Public/codex-shell-home/NavSentinel-ri01`, where tracked
  `tests/clickfix-detector.property.test.ts` remains deleted. Do not restore,
  clean, reset, or stage it without Chris completing AI-20.

## Open human items — surface all of these

- **Resume at: AI-16** (`q-1` in the current guided conversation).
- **AI-16:** ratify/amend the July 3, July 10, and July 13 standing decisions.
- **AI-9:** choose interaction-only or real-filter beta profile.
- **AI-20:** review the Defender quarantine and restore/allow only the exact
  tracked fixture, or choose the coverage-preserving rewrite path.
- **AI-17:** enable `main` branch protection.
- **AI-19:** clear or replace the product name before CWS submission.
- **AI-18: READY:** the hook-editing slice is committed; review/trust the exact
  project-local Codex hook definitions before relying on them.
- **AI-13: OPEN / CONDITIONAL:** run the exact-head-guarded #356 Chrome Gate-3
  guide only after its current-main refresh and live review/CI prechecks pass.
- **AI-21: OPEN / CONDITIONAL:** run PR #464's exact-head-guarded synthetic
  navigation Chrome Gate-3 guide only after its live review/CI prechecks pass.
- **AI-22: OPEN / CONDITIONAL:** run PR #466's exact-head-guarded dormant broker
  Chrome Gate-3 guide only after its live review/CI prechecks pass.
- **AI-15: BLOCKED** until agent preflight is complete.
- **AI-8 / AI-14: BLOCKED** pending current branches, two fresh reviews, green
  CI, and replacement human guides.

## Verified state

- v0.4.0; no tag, GitHub release, CWS release, classic branch protection,
  repository ruleset, or external-user evidence.
- GitHub private vulnerability reporting is enabled and `SECURITY.md` links the
  verified private advisory route.
- Root `main` is clean and matches `origin/main` at merge commit `2888483`.
- 80 open issues with no milestone/assignee; 15 Horizon issues #439–#453 are a
  frozen option portfolio, not active work.
- Stale PRs #273 and #399 were closed on 2026-07-13 with re-entry paths and
  issue anchors preserved. Open PRs are #356, draft #457, #464, and #466.
- PR #463 merged exact green dependency head `91aab4f` as `2888483` and closed
  #459. It carries CRXJS 2.7.1, Vite 8.1.5, Rollup 2.80.0, Rolldown 1.1.5,
  audit zero, and the aligned Node engine floor.
- PR #356's current-main exact head is fully gated and human-held by AI-13.
  PR #464's `8aee243` service-worker fix, `a14f70d` MAIN-world follow-up, and
  `f824381` Navigation Off preservation, and `e26dba9` child-frame cold-worker
  context fix, plus `7a9243a` stale-ordering guard, have mutation/integration
  coverage; the latest tree passes typecheck, lint, build, 2,877 units, affected Chromium
  controls, and all 12 performance budgets. Live exact-head review/Codex/CI
  evidence remains authoritative.
  Neither PR may merge without its human Gate-3.
- PR #466's Cycle 53 runtime tree passed 176 focused broker/SW tests, typecheck,
  lint, build, 2,901 units, rollback 3/3, all 64 one-worker E2E, package, and
  all 12 performance budgets after merging current `main`. The first exact-head
  recheck found three valid blockers: unsupported MV3 `import()`, a consume
  request requiring an unavailable raw destination, and stale child-frame
  liveness based on `getFrame`. Commits `6a18f1d` and `8c0fed1` replace those
  with a worker-owned capability, exact `getAllFrames` verification, and a
  static module split. Candidate `af0ccb2` was pushed, passed exact-head CI, and
  had all four historical threads resolved. The first independent re-review then
  found a new medium gate gap: build/package could still pass if bundling
  reintroduced an unloadable worker graph. `dfea4da` adds the emitted-graph
  verifier to both paths plus the initial nine pass/fail fixtures. Fresh round 2
  then proved the regex missed comment-separated dynamic imports, namespace
  re-exports, and comment-separated static imports/re-exports. `5d6ad17` and
  `ab6d845` add the 17-fixture regression set; `ddfacf0` replaces the hand-
  rolled regex parser with direct `es-module-lexer` import metadata. A fresh
  follow-up then proved the lexer alone accepted unsupported static import
  attributes/assertions. `c0305f9` adds syntax-aware rejection plus four pre-fix-
  failing fixtures (21 total); the real five-module emitted graph passes.
  Final runtime `0266107` additionally restricts persisted signal values to the
  finite `cross_site` / `NRS-high` set. Local/remote/PR heads match; both fresh
  independent reviews and exact Codex review are clean, all four historical
  threads are resolved, closing references are empty, and GitHub run
  `29561311422` passed Build/Unit and E2E (release skipped as configured).
  AI-22 remains mandatory and human-owned.
- PR #466's package is about 492.9/500KB while reputation is a 52-byte test fixture. The
  old 150KB/100K-domain plan cannot meet its stated 0.01% FP target or aggregate
  package cap as written.
- Product-posture and guided-workflow work merged through PR #454; verify live
  `main` rather than pinning its SHA. The RI-01 checkpoint branch is remotely
  backed up without the unstaged Defender deletion; verify its SHA live. Its
  worktree remains dirty only because of the Defender-quarantined fixture.
- The RI-01 broker foundation is now wired as a dormant service-worker
  create/list/consume boundary with top-navigation/tab-removal cleanup. It does
  not yet have a producer, popup UI, or privileged action executor, and it does
  not remove the legacy injected allow/trust/resume authority or complete RI-01.

## Local review evidence

- **PR #466 independent round 1 (exact `af0ccb2`, 2026-07-17):** validated the
  worker-owned consume capability, positive child-frame enumeration, and static
  emitted graph, but found one medium release-gate gap and one low status-truth
  gap. Build/package did not automatically reject dynamic/preload, missing,
  remote, or out-of-dist worker imports; the durable queue still called the
  pushed, CI-green candidate local. `dfea4da` fixes the gate with a recursive
  emitted-closure verifier and nine pass/fail fixtures; this status sync fixes
  the low finding. Both review rounds must restart from the final exact head.

- **PR #466 independent round 2 (exact `7e173eb`, 2026-07-17):** found one
  medium release-gate bypass and one low status gap. The graph regex missed
  valid comment-separated dynamic/static imports and re-exports plus namespace
  re-export edges, so it could omit an unloadable or missing reachable chunk;
  `5d6ad17`/`ab6d845` add eight fixtures and `ddfacf0` moves edge discovery to
  a real module lexer. The handoff
  still described push as future after `7e173eb` was already remote/PR-equal and
  exact-head CI-green; this status sync removes that transient claim. Both
  independent rounds restart on the final exact head.

- **PR #464 pre-final adversarial round (two independent lenses, 2026-07-17):**
  the initial isolated commit regressed Level 6. One lens found that discarding
  the preceding trusted pointerdown removed retarget/fast-attempt evidence and
  could let a hidden synthetic `_blank` activation escape. The other reproduced
  the escaped tab and identified missing native-anchor and MAIN redirect
  coverage. Fixed in `aa9fa3a`: trusted-only `lastDown` remains correlation
  evidence, allowance writes remain gated by the current event's trust, the
  benign-anchor exemption now requires a trusted click, and the tests assert no
  popup plus SW/MAIN/native-anchor/redirect rejection. Gemini's two follow-up
  threads then exposed one valid logging leak and one adjacent modifier-seeded
  authority leak. `76da96b` prevents synthetic allowed clicks from emitting a
  silent-navigation log; `8874459` requires the current click to be trusted
  before modifier/new-tab intent can lower its risk. Mutation probes failed
  before each fix and pass after it. This committed ledger intentionally does
  not pre-claim its own final review or CI outcome. The exact SHA, CI run,
  bot/thread accounting, and final review evidence must live on PR #464 after
  this commit; any later head invalidates them.

- **PR #464 fresh round 2 finding and fix (`6332142` -> runtime `8aee243`,
  2026-07-17):** round 1 was clean, but the independent second lens proved a
  trusted pointerdown alone emitted targetless `ns-nav-gesture` authority that a
  delayed synthetic same-tab cross-site link could spend. A repository Chromium
  regression failed before the fix because `ns_sw:gestureUntil` was populated.
  Removing that call exposed a cold-worker baseline dependency: without a known
  previous URL the worker could not roll back the first suspicious commit. The
  final fix adds `ns-nav-context`, accepted only from top-frame content and
  sourced from Chrome's `sender.tab.url`; it persists `lastUrl` without creating
  any authority. The regression and eight trusted/synthetic compatibility cases
  pass after the fix. This is not final review evidence: the next session must
  run two independent reviews from the final exact head, fix every finding,
  rerun affected checks after every head change, request an exact-head Codex
  review, audit all threads, and require green CI.

- **PR #464 resumed independent round 1 (`cdcfb45` -> runtime `a14f70d`,
  2026-07-17):** found one medium scope-truth gap. MAIN-world smart mode armed
  `popupIntentArmed` from trusted pointerdown/mousedown, so a page handler could
  synchronously spend one popup and exact-target relay before any click.
  `a14f70d` removes those arming calls while preserving click and keyboard
  compatibility. The new Chromium control fails on the vulnerable mutation by
  observing an opened popup and passes after the fix; the eight-case affected
  lane, typecheck, lint, build, 2,875 units, performance 12/12, and diff check
  pass. No other round-1 finding remained. Round 2, Codex/thread audit, and CI
  must all target the final documentation head; their exact evidence belongs on
  PR #464 so this durable ledger does not pre-claim a later head.

- **PR #464 independent round 2 (`897cadd` -> runtime `f824381`,
  2026-07-17):** found one medium compatibility regression. The trusted-event
  gate in the isolated capture also suppressed Navigation Off's intentional
  programmatic-navigation bypass, allowing the worker to queue rollback and
  forward state even though Off promises no intervention. `f824381` permits
  allowance emission only for trusted clicks or explicit Off mode. The new
  Chromium control fails on the vulnerable mutation with both session entries
  populated and passes after the fix; four affected E2E controls, typecheck,
  lint, build, 2,875 units, performance 12/12, and diff check pass. A fresh
  round 2, exact-head Codex review, thread audit, and CI must target the final
  documentation head.

- **PR #464 fresh final-head round 2 (`f5acaef` -> runtime `e26dba9`,
  2026-07-17):** found one medium lifecycle/provenance gap. A trusted
  pointerdown in a child frame could top-navigate while a cold worker lacked
  `lastUrlByTab`, because both the sender and receiver restricted
  `ns-nav-context` to frame 0. `e26dba9` emits the non-authorizing context from
  trusted pointerdown in every frame and accepts content-script child frames,
  but continues to derive the baseline solely from Chrome's `sender.tab.url`.
  The new unit proves a child-supplied URL is ignored and no authority maps are
  created. The Chromium mutation sticks on the cross-host destination before
  the fix and rolls back after it; four affected E2E controls, 28 session-state
  tests, typecheck, lint, build, 2,875 units, and performance 12/12 pass. Final
  round-2, Codex/thread audit, and CI restart on the next documentation head.

- **PR #464 final-head re-review (`d887270` -> runtime `7a9243a`,
  2026-07-17):** found two medium code/test gaps plus the expected stale PR
  body. A hydration-delayed `ns-nav-context` snapshot could overwrite a newer
  top-frame commit, causing the next rollback/forward offer to reference the
  wrong page. The child-frame E2E and inspector-open AI-21 step also did not
  deterministically create a cold worker. `7a9243a` validates the sender's
  Chrome-derived URL against the live tab, repeats the read when the baseline
  changes during the async gap, and lets a newer commit win while preserving a
  stable SPA URL refresh. Session-state tests now deterministically cover a
  missing child-frame baseline, ignored child URL input, stable SPA refresh,
  no authority maps, and stale-after-commit rejection. Chromium/AI-21 evidence
  is accurately scoped to frame provenance and rollback. Four affected E2E,
  29 session-state, typecheck, lint, build, 2,876 units, and performance 12/12
  pass. The PR body is updated only after the next exact head is fully gated.

- **PR #464 async-gap proof review (`0475c6a` -> tests `716a60e` +
  `d2fbd8c`, 2026-07-17):** found one medium test-validity gap. The existing
  stale-context test committed before dispatch and would still pass if the
  generation-sensitive second tab read were removed. The new controllable
  `tabs.get` mock holds the first stale read from source A, commits B during the
  gap, then requires a second live read and asserts B remains plus exactly two
  API calls. Removing the second-read branch fails at the pending-call
  assertion; restored runtime passes 30/30 session-state tests. `d2fbd8c`
  preserves exact-optional typing in the mock. Typecheck, lint, and full 2,877
  units pass. Final round-2, Codex/thread audit, and CI restart on the next
  documentation head.

- **Agentic contract round 1 (runtime/parity lens, 2026-07-17):** compared
  Codex instructions, hooks, skills, and shared references against the compact
  Claude contract and current Codex hook guidance. Fixed the oversized Codex
  root contract, a stale named parallel-tool reference, and retired
  pre-dispatch hook references. The actual `.codex/hooks.json` definitions were
  unchanged and remain covered by AI-18 trust review.
- **Agentic contract round 2 (fresh hook/recovery lens, 2026-07-17):** checked
  supported Codex hook matchers and trust behavior, reviewed the revised Git
  safety/recovery instructions, and reran Python compilation, hook smoke, skill
  parity, and diff-whitespace checks. No remaining actionable findings.

- **Audit caveat:** the earlier posture/RI handoff claims 11 documentation
  findings and two RI-01 review rounds, but the inspected local branches do not
  preserve a per-finding artifact. Treat those counts as process history, not
  independently auditable merge-gate evidence.
- **Agentic workflow round 1 (independent contract/parity lens, 2026-07-12):**
  reviewed the new mirrored skill, root routing, question protocol, hook
  dispatch, queue/status parity, and validation. Fixed four findings: Codex
  `apply_patch` did not match PostToolUse, Claude lacked `Edit`/`Write`, `q-N`
  increment/reset semantics were incomplete, and duplicate/conflicting AI IDs
  or HANDOFF status drift could pass silently.
- **Agentic workflow round 2 (fresh recovery/adversarial lens, 2026-07-12):**
  reviewed the updated cursor recovery boundary and harness behavior. Fixed
  stale, blocked, nonexistent, and absent-cursor fail-open paths; added positive
  coverage for an all-blocked queue; and clarified that AI-18 becomes ready
  only after hook definitions are final and unchanged. Those definitions are
  now committed. Final re-review: clean.
- **Forward-test lens:** exercised the sequence as a maintainer handoff. The
  `q-1` / AI-16 guide, exact reply, durable `AI-N` resume semantics, and
  AI-18 conditional readiness are internally consistent after fixes.
- **#459 round 1 (fresh supply-chain/build-portability lens, 2026-07-17):** no
  lockfile, peer-range, audit, or production-build defect. It found unverified
  CRXJS/Vite dev-HMR debt and stale handoff evidence. The HMR debt is tracked in
  #462 without widening `externally_connectable`; this sync fixes the evidence.
  A root `@emnapi/runtime` entry can appear extraneous after clean install, but
  untouched `origin/main` reproduces the same npm optional-dependency behavior.
- **#459 round 2 (fresh supply-chain/portability/docs lens, 2026-07-17):** no
  branch-introduced runtime, graph, provenance, or build defect. It found a
  pre-existing release-guide mismatch: Node 20.18.1 was documented while the
  root engine required a newer range. `614953b` aligned that guide and exact-head
  re-review was clean. Gemini then requested exact semver syntax rather than
  natural-language `or`; `da44f56` fixed it. A later Codex portability review
  found the full ESLint 10 graph is narrower still, so the root declaration,
  lock root, and release guide now use `^20.19.0 || ^22.13.0 || >=24`. Copilot's
  quota-limit response on #463 is an invalid review signal, not a skipped finding.

## Release blockers in order

1. **RI-01:** page-injected UI currently authorizes allow/trust/resume. Move all
   protection-lowering decisions to tab/destination-bound extension-origin UI;
   script rejection/closed roots alone do not stop trusted-click redressing.
2. **RI-03/#356:** confirm the refreshed branch's live head equality, both
   exact-head reviews, and green CI, then complete AI-13 human Gate-3;
   recreate or defer #273's intent and keep closed #399 outside beta blockers.
3. **RI-02/#424:** excise visual-sim. It has no production match path and can
   process a different active tab's pixels.
4. **RI-05/RI-06:** remove fake DNR; apply purpose-specific URL/data
   minimization, TTLs, controls, and complete behavioral reset.
5. **RI-07:** add the explicit beta capability profile and prove broad JS
   behavior wrappers are off while core navigation protection remains active.
6. **RI-08:** complete #175/#186 trusted bridge identity and bounded fail-closed
   recovery before inviting beta users.
7. **PM-03/#455:** evidence pre-install CWS disclosure/affirmative consent, then
   keep fresh installs passive until in-product disclosure/activation; include
   the Limited Use declaration and redact OAuth response secrets before storage/export.
8. **AI-9:** implement the chosen beta profile; the recommended default is
   interaction-only with no reputation claim.
9. **AI-19 + CWS:** settle name, then re-verify one canonical store/privacy copy,
   assets, permissions, fresh install, and package.
10. Run the current headed regression checklist, submit unlisted, and recruit the
   first 10-user cohort.

Before public launch, obtain an external security review of the exact beta
commit/package and publish valid corpus, quietness, and current-browser
comparative evidence.

## Next safe slice

Resume PR #464 only. Fetch and confirm final local/origin/PR equality, then use
the live PR as authority for round-2, exact-head Codex, every comment/thread,
closing references, and Build/Unit plus E2E. Fix any finding and restart the
invalidated gates. When all automated evidence belongs to one unchanged head,
stop at AI-21 for Chris's real-Chrome Gate-3; do not merge or start a fourth
browser slice. Leave #356 and #466 unchanged and human-held by AI-13/AI-22.

## Copy-paste prompt for the next session

```text
Resume the NavSentinel clean-stop checkpoint from the repository root. Begin
with the worktree guard preamble, read ACTION_ITEMS.md, AGENTS.md, CLAUDE.md,
docs/Project_Roadmap.md, autodoc/AGENT_INDEX.md,
docs/agentic/HANDOFF.md, and docs/agentic/ORCHESTRATOR.md, then refresh live
git/GitHub truth. Preserve every existing worktree and do not touch the known
Defender-quarantined deletion in C:/Users/Public/codex-shell-home/NavSentinel-ri01.

Own PR #464 only until it is cleanly handed to AI-21. Confirm the final
local/origin/PR head equality, current CI, PR body, comments, unresolved threads,
and closing references. Round 1 on `cdcfb45` found MAIN-world pointerdown popup
authority; runtime `a14f70d` fixes it with mutation-proven Chromium coverage.
Round 2 on `897cadd` found Navigation Off's bypass regression; `f824381` fixes
it with a pre-fix-failing rollback/forward control. Fresh final-head review on
`f5acaef` found the child-frame cold-worker baseline gap; `e26dba9` fixes it
without accepting page URL input. Re-review on `d887270` found stale context
ordering and overclaimed cold-worker browser setup; `7a9243a` fixes the ordering
and adds deterministic integration coverage. Review on `0475c6a` found the
second-read proof gap; `716a60e` makes it mutation-sensitive. Run a fresh
independent round 2 on the final
documentation head, request and
audit exact-head Codex review, and require green Build/Unit plus E2E. Fix every
finding and restart invalidated gates. Update the PR body/evidence after the
head is stable; edit status docs again only if a new finding changes their
truth. Run hook smoke, skill validation, JSON/Python syntax, and diff check.
Do not merge: AI-21 real-Chrome Gate-3 is human-owned.

Audit but do not rework PR #356 (exact f8028c9, automated gates green, AI-13)
or PR #466 (exact 0266107, automated gates green, AI-22) unless live truth has
changed. Leave root main clean, commit/push small logical increments, account
for every touched item, and finish with changed / verified / not verified /
failures / both review rounds / docs sync / all OPEN-BLOCKED AI-N items / queue
accounting / next safe slice.
```

## Queue accounting

- **Open / human-held:** #356 is ready for AI-13; #466 is ready for AI-22. #464
  becomes ready for AI-21 only when its live final-head round-2, Codex/thread,
  closing-reference, and CI prechecks all pass. None may merge from automation.
- **Merged:** #463 / #459 as `2888483`; intended close link verified.
- **Open / in progress:** PR #466 pending-decision SW boundary; the three runtime
  blockers, emitted-graph gate, lexer gaps, and unsupported import-attribute gap
  are fixed. Its live precheck requires local/remote/PR equality, exact-head
  reviews, bot/thread accounting, green CI, and AI-22.
  #356's final exact head passes its full gates. PR #464's runtime fixes are
  `8aee243`, `a14f70d`, `f824381`, `e26dba9`, and `7a9243a`; `716a60e` proves
  the async-gap branch. The final documentation head
  uses live PR evidence for round-2, Codex/thread, closing-reference, and CI
  status. #466's
  `0266107` exact head passes its full automated gates. Every human guide still
  begins with live local/remote/PR equality.
- **Parked:** draft #457 agent-harness tooling; closed #273/#399 retain explicit
  re-entry paths.
- **Blocked:** AI-15, AI-8, and AI-14.
- **Deferred human decisions/actions:** AI-16 (resume cursor), AI-9, AI-20,
  AI-17, AI-19, AI-18, AI-13, AI-21, and AI-22. No item was silently dropped or
  self-cleared.

## Reliability notes

- The first #464 fix removed pointerdown authority but also removed the only
  source-URL baseline when a cold worker missed the initial commit. The new E2E
  stayed on the synthetic destination and a temporary service-worker trace
  showed empty `lastCommitted`/`pendingRollback` plus only the destination in
  `lastUrl`. Replacing the call with non-authorizing, top-frame `ns-nav-context`
  fixed the regression. The temporary diagnostic listener/output was removed.
- The current environment did not perform real Chrome behavior, CWS submission,
  real-feed building, external audit, or trademark/legal clearance.
- Treat successful CI as regression evidence, not efficacy evidence.
- #462 tracks CRXJS 2.7.1's deprecated Vite HMR option and unverified MAIN-world
  HMR. Production build/package/E2E passed; no `externally_connectable` widening
  is authorized by #459.
- #460 tracks nondeterministic Windows four-worker blank-anchor misses; use the
  supported one-worker proving topology. #461 tracks Windows CRLF false-stale
  output from `check:topsites`; exact-head Linux CI remains authoritative.
- #465 tracks reproducible Happy DOM native-fetch teardown stacks in two
  pre-existing JS-behavior suites. Both suites and the full 2,901-test run pass,
  but the pending native fetch should be drained or mocked by the harness.
- PR #466 leaves only about 7.1KB aggregate and 1.7KB service-worker budget
  margin. Its static pending-runtime chunk is required because Chrome MV3
  extension service workers do not support dynamic `import()`; ordinary build
  and package now re-prove the emitted graph automatically, while perf still
  enforces both size budgets.
- The first emitted-worker verifier used an incomplete import regex, then an
  overbroad page-global check against a pre-existing shared storage chunk. Both
  were invalid verifier signals; the corrected targeted check proved a module
  background, a static worker-to-pending-runtime edge, and no `import()` or
  module-preload helper in the new worker/pending path.
- The first post-fix full E2E command was killed by an incorrectly short shell
  timeout and Playwright's reporter emitted `EPIPE`. That was a coordinator
  invalid signal; the unchanged, correctly timed one-worker rerun passed 64/64.
- PowerShell did not expand `scripts/agent_hooks/*.py` for `py_compile`; that was
  an invalid syntax-check invocation. `python -m compileall -q
  scripts/agent_hooks` is the working cross-file check and passed.
- The bundled GitHub thread helper first failed decoding CLI output with Windows
  `cp1252`; rerunning it with `PYTHONUTF8=1` produced the complete four-thread
  audit. Preserve UTF-8 mode for future thread audits on this machine.
- The first post-round-1 rollback lane timed out once waiting for Level 10's
  return navigation. That exact case then passed 3/3 repeated, the full rollback
  lane passed 3/3, and the full one-worker lane passed 64/64. This is retained as
  a non-blocking nondeterministic signal: capture a trace plus worker/page logs
  and seed a dedicated harness issue if it recurs; do not silently retry it.
- The first `c8119c1` full one-worker lane reached 63/64 because Chromium's
  persistent context timed out during launch before RW-10 Space executed, after
  47 earlier cases passed. No Chrome process or test profile remained afterward;
  the exact case then passed 3/3 in fresh contexts. Retain this as a non-blocking
  Windows harness signal: if it recurs, capture `DEBUG=pw:browser` launch logs
  and seed a dedicated issue rather than treating a retry as the full-suite gate.
- Update shared branches with `git merge main`, never rebase; do not discard work
  or rewrite history without the explain-and-approve protocol.
- Do not edit `extension/dist/` or generated data directly.
