# Session Handoff — NavSentinel

**Last updated:** 2026-07-17. Always refresh git/GitHub truth before acting.
`ACTION_ITEMS.md` holds the live human-facing snapshot without pinning a SHA;
the posture review's dated exact baseline is in `docs/Product_Strategy.md`.

This is the short next-loop entry point. Product direction is in
`docs/Product_Strategy.md`; execution gates are in `docs/Project_Roadmap.md`;
standing decisions are in `docs/agentic/DECISIONS.md`; human-only work is in
`ACTION_ITEMS.md`; historical cycle detail remains in `ORCHESTRATOR.md` pending
rotation under #437.

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
- PR #356 and #464 were twice reviewed, thread-clean, and exact-head CI-green
  before #463 changed `main`'s dependency graph. Their current-main refreshes are
  committed locally as `5692e08` and `c7870aa`, respectively. #356 passes 2,875
  unit plus 65/65 one-worker E2E; #464 passes 2,874 unit plus 65/65 one-worker
  E2E. Push, full exact-head CI, and both fresh reviews remain; neither may merge
  without its human Gate-3 evidence.
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
  verifier to both paths plus nine pass/fail fixtures. Live remote equality,
  exact-head reviews, thread accounting, and CI remain authoritative.
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
2. **RI-03/#356:** integrate current `main`, repeat exact-head reviews/CI, then
   complete AI-13 human Gate-3;
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

Push PR #466's gate/status fixes, map the round-1 finding to `dfea4da`, then run
two fresh exact-head reviews, bot/thread accounting, and CI; leave it human-held
for AI-22. Then push the committed current-main refreshes for #356 and #464;
both must repeat exact-head reviews/CI before AI-13 or AI-21 is actionable. Do
not start a fourth browser-held slice.

## Queue accounting

- **Open / human-held:** #356 (AI-13), #464 (AI-21), and #466 (AI-22);
  none may merge from automation alone.
- **Merged:** #463 / #459 as `2888483`; intended close link verified.
- **Open / in progress:** PR #466 pending-decision SW boundary; the three runtime
  blockers and the emitted-graph gate finding are fixed, while live remote
  equality, exact-head reviews, bot/thread accounting, CI, and AI-22 remain.
  #356's current-main merge is committed locally as `5692e08`, passes 2,875 unit
  plus 65/65 E2E, and is unpushed. #464's merge is committed locally as
  `c7870aa`, passes 2,874 unit plus 65/65 E2E, and is unpushed.
- **Parked:** draft #457 agent-harness tooling; closed #273/#399 retain explicit
  re-entry paths.
- **Blocked:** AI-15, AI-8, and AI-14.
- **Deferred human decisions/actions:** AI-16 (resume cursor), AI-9, AI-20,
  AI-17, AI-19, AI-18, AI-13, AI-21, and AI-22. No item was silently dropped or
  self-cleared.

## Reliability notes

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
- The first post-round-1 rollback lane timed out once waiting for Level 10's
  return navigation. That exact case then passed 3/3 repeated, the full rollback
  lane passed 3/3, and the full one-worker lane passed 64/64. This is retained as
  a non-blocking nondeterministic signal: capture a trace plus worker/page logs
  and seed a dedicated harness issue if it recurs; do not silently retry it.
- Update shared branches with `git merge main`, never rebase; do not discard work
  or rewrite history without the explain-and-approve protocol.
- Do not edit `extension/dist/` or generated data directly.
