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
- **AI-8 / AI-14: BLOCKED** pending current branches, two fresh reviews, green
  CI, and replacement human guides.
- **AI-13: OPEN, guide prepared:** use it only when step 1 confirms the current
  pushed head and CI are exact/green. Chris's manual Gate-3 remains required.

## Verified state

- v0.4.0; no tag, GitHub release, CWS release, classic branch protection,
  repository ruleset, or external-user evidence.
- GitHub private vulnerability reporting is enabled and `SECURITY.md` links the
  verified private advisory route.
- `origin/main` remains at the last verified green GitHub head; the root `main`
  worktree is clean but carries one unpushed agent-tooling commit and must not be
  reset or overwritten.
- PR #356 / RI-03 was refreshed by merging current `origin/main`. Its runtime
  head `2a30c63` passed two independent adversarial rounds, 2,875 unit tests,
  all 65 one-worker E2E tests, build/package, and perf 12/12. Pushed head
  `1accb43` passed GitHub Build/Unit and E2E in run `29546364063`; all three
  review threads are resolved. The current guide-only head must be pushed,
  reviewed, and re-green; ACTION_ITEMS step 1 enforces that boundary. AI-13
  human Gate-3 remains mandatory.
- 79 open issues with no milestone/assignee; 15 Horizon issues #439–#453 are a
  frozen option portfolio, not active work.
- Open PRs are #356 (browser-surface, Gate-3 held) and draft #457 (shared deny
  floor, green at its separately verified head). Stale PRs #273 and #399 remain
  closed with their re-entry anchors preserved.
- Package is about 474/500KB while reputation is a 52-byte test fixture. The
  old 150KB/100K-domain plan cannot meet its stated 0.01% FP target or aggregate
  package cap as written.
- Product-posture and guided-workflow work merged through PR #454; verify live
  `main` rather than pinning its SHA. The RI-01 checkpoint branch is remotely
  backed up without the unstaged Defender deletion; verify its SHA live. Its
  worktree remains dirty only because of the Defender-quarantined fixture.
- The RI-01 broker foundation is unit-tested but not wired into production.
  Only the synthetic-navigation allowance rejection changes active runtime
  behavior; that two-file change can be isolated from the AI-20-blocked
  checkpoint, but its new real-browser E2E has not run.
- Current dev/build dependencies produce three high-severity `npm audit`
  findings with non-major fixes available (#459). Windows four-worker headed
  E2E also has pre-existing nondeterministic blank-anchor misses (#460), while the
  supported one-worker CI topology is green locally. `check:topsites` has a
  Windows CRLF false-stale signal with content proven equal after normalization
  (#461). Ordinary Chromium `location.assign`/`replace` calls still bypass the
  compatibility prototype wrappers (#458).

## Local review evidence

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
- **PR #356 round 1 (fresh correctness/security/runtime lens, 2026-07-17):**
  found two P2 bugs and one P3 stale claim: cross-realm/invalid `window.open`
  receivers were rewritten, Chromium's absent Location prototype methods were
  captured as natives, and monitor docs described obsolete hardening order.
  Fixed in `1a36bee` with real Chromium receiver/location invocation coverage.
- **PR #356 round 2 (fresh compatibility/test-validity lens, 2026-07-17):**
  found two P2s: native enumerability changed, and assignment-only E2E could
  pass without a page wrapper remaining in the call chain. Fixed in `2a30c63`;
  exact-head re-review was clean with one-call counters and native outcomes for
  submit/requestSubmit, assign/replace, and own/prototype open.

## Release blockers in order

1. **RI-01:** page-injected UI currently authorizes allow/trust/resume. Move all
   protection-lowering decisions to tab/destination-bound extension-origin UI;
   script rejection/closed roots alone do not stop trusted-click redressing.
2. **RI-03/#356:** obtain AI-13 manual Chrome Gate-3 using the current guide; do
   not merge from local/browser automation alone.
3. **#459:** clear the current Vite/Rollup advisories with the available
   non-major dependency update and prove Windows Gym/build/package behavior.
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

Take #459 as the next small non-browser release-integrity slice: update only the
Vite/CRXJS lock surface, require `npm audit` zero, exercise Windows `gym:serve`,
and run the normal build/package gates plus two independent reviews. Then
isolate the active two-file RI-01 synthetic-navigation allowance rejection from
commit `6283f49` onto fresh current `origin/main`; keep it browser Gate-3 held.
The larger RI-01 broker checkpoint remains backup-only until AI-20 and its full
integration/gate sequence are complete.

## Reliability notes

- The current environment did not perform real Chrome behavior, CWS submission,
  real-feed building, external audit, or trademark/legal clearance.
- Treat successful CI as regression evidence, not efficacy evidence.
- Run the local headed E2E proof with one worker until #460 determines whether
  the four-worker Windows nondeterminism is product or harness behavior; do not
  add retries or weaken tests.
- On Windows, #461 means `check:topsites` can fail solely on CRLF. The normalized
  content equality was proven this cycle, but only Linux CI currently proves the
  official command without that false signal.
- Update shared branches with `git merge main`, never rebase; do not discard work
  or rewrite history without the explain-and-approve protocol.
- Do not edit `extension/dist/` or generated data directly.
