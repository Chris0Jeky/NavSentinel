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
- **AI-15: BLOCKED** until agent preflight is complete.
- **AI-8 / AI-13 / AI-14: BLOCKED** pending current branches, two fresh reviews,
  green CI, and replacement human guides.

## Verified state

- v0.4.0; no tag, GitHub release, CWS release, classic branch protection,
  repository ruleset, or external-user evidence.
- GitHub private vulnerability reporting is enabled and `SECURITY.md` links the
  verified private advisory route.
- Root `main` is clean and matches `origin/main` at `ebddd27`; its exact-head
  GitHub CI is green.
- PR #463 / #459 at dependency head `3f858df` resolves CRXJS 2.7.1, Vite
  8.1.5, Rollup 2.80.0, and Rolldown 1.1.5. `npm ci` and audit zero passed, as
  did typecheck, lint, build, version, 2,874 unit tests (95 files), 64/64
  one-worker E2E, all 12 size budgets, package, and Windows Gym HTTP proof.
  Two independent local rounds have no remaining findings through `614953b`;
  every later docs-only head still requires exact revalidation and live CI.
- 80 open issues with no milestone/assignee; 15 Horizon issues #439–#453 are a
  frozen option portfolio, not active work.
- Stale PRs #273 and #399 were closed on 2026-07-13 with re-entry paths and
  issue anchors preserved. Open PRs are #356, draft #457, and #463. #356's
  pre-guide head passed Build/Unit and E2E with all three threads resolved; its
  current human-guide head must satisfy the live head/review/CI precheck before
  Gate-3.
- Package is about 474/500KB while reputation is a 52-byte test fixture. The
  old 150KB/100K-domain plan cannot meet its stated 0.01% FP target or aggregate
  package cap as written.
- Product-posture and guided-workflow work merged through PR #454; verify live
  `main` rather than pinning its SHA. The RI-01 checkpoint branch is remotely
  backed up without the unstaged Defender deletion; verify its SHA live. Its
  worktree remains dirty only because of the Defender-quarantined fixture.
- The RI-01 broker foundation is unit-tested but not wired into production.
  Only the synthetic-navigation allowance rejection changes active runtime
  behavior; its new real-browser E2E has not run.

## Local review evidence

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
  effective graph requires `^20.19.0 || >=22.12.0`. `614953b` aligns the guide;
  exact-head re-review was clean. Copilot's quota-limit response on #463 is an
  invalid review signal, not a skipped finding.

## Release blockers in order

1. **RI-01:** page-injected UI currently authorizes allow/trust/resume. Move all
   protection-lowering decisions to tab/destination-bound extension-origin UI;
   script rejection/closed roots alone do not stop trusted-click redressing.
2. **RI-03/#356:** finish the current guide head's push/review/CI, then obtain
   human Gate-3; keep closed #399 outside beta blockers.
3. **#459/#463:** require live exact-head Linux CI and resolve any later PR
   comments; do not claim real-Chrome dev/HMR verification.
4. **RI-02/#424:** excise visual-sim. It has no production match path and can
   process a different active tab's pixels.
5. **RI-05/RI-06:** remove fake DNR; apply purpose-specific URL/data
   minimization, TTLs, controls, and complete behavioral reset.
6. **RI-07:** add the explicit beta capability profile and prove broad JS
   behavior wrappers are off while core navigation protection remains active.
7. **RI-08:** complete #175/#186 trusted bridge identity and bounded fail-closed
   recovery before inviting beta users.
8. **PM-03/#455:** evidence pre-install CWS disclosure/affirmative consent, then
   keep fresh installs passive until in-product disclosure/activation; include
   the Limited Use declaration and redact OAuth response secrets before storage/export.
9. **AI-9:** implement the chosen beta profile; the recommended default is
   interaction-only with no reputation claim.
10. **AI-19 + CWS:** settle name, then re-verify one canonical store/privacy copy,
   assets, permissions, fresh install, and package.
11. Run the current headed regression checklist, submit unlisted, and recruit the
   first 10-user cohort.

Before public launch, obtain an external security review of the exact beta
commit/package and publish valid corpus, quietness, and current-browser
comparative evidence.

## Next safe slice

Verify #463's live exact-head CI/comments and keep #459 open until merge. Then
isolate only the active two-file RI-01 synthetic-navigation allowance rejection
from commit `6283f49` onto fresh `origin/main`; keep it browser Gate-3 held. The
larger RI checkpoint remains backup-only until AI-20 and its full integration
sequence are complete.

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
- Update shared branches with `git merge main`, never rebase; do not discard work
  or rewrite history without the explain-and-approve protocol.
- Do not edit `extension/dist/` or generated data directly.
