# Session Handoff — NavSentinel

**Last updated:** 2026-07-13. Always refresh git/GitHub truth before acting.
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
- Main: typecheck, lint, build, version check, 2,874 unit tests (95 files), perf
  12/12, smoke E2E, and current GitHub CI green.
- 75 open issues with no milestone/assignee; 15 Horizon issues #439–#453 are a
  frozen option portfolio, not active work.
- Stale PRs #273 and #399 were closed on 2026-07-13 with re-entry paths and
  issue anchors preserved. #356 remains the sole active legacy browser-surface
  PR; it is stale with E2E red. Human Gate-3 would be premature.
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

## RI-01 local progress — not complete

- Local branch `fix/ri01-extension-origin-decisions` contains the reviewed
  pending-decision broker foundation (`d2963f5`) and rejects synthetic
  navigation allowances (`6283f49`). Product-posture docs are merged locally
  at `f9bd121`; nothing has been pushed and no fourth PR was opened.
- The broker binds decisions to verified tab/window/frame/document/source/top/
  destination context, stores URL hashes plus display origins rather than exact
  URLs, uses reason-specific actions, bounds each tab to eight 30-second
  records, and consumes before delivery. Focused broker tests pass 13/13;
  focused lint and TypeScript checks pass.
- RI-01 remains **OPEN**. Service-worker handlers, active-tab sender checks,
  content delivery, popup decision UI, and conversion of injected prompts to
  warn/cancel-only are not wired. The physical cleanup policy for expired
  hashed/origin metadata must also be decided before completion; current
  access/hydration/tab-lifecycle pruning makes stale records inert but may leave
  bounded metadata in `storage.session` until another lifecycle event.
- Real-browser E2E and the full unit/build/performance suite were not run for
  this branch. Windows Defender quarantined only the RI worktree copy of
  `tests/clickfix-detector.property.test.ts` while it was read, reporting
  `Trojan:HTML/FakeCaptcha.HNA!MTB`, `DidThreatExecute=False`, and
  `IsActive=False`. The deletion is intentionally unstaged; do not bypass the
  scanner. See the failure ledger and have Chris review the exact fixture before
  any restore.

## Release blockers in order

1. **RI-01:** page-injected UI currently authorizes allow/trust/resume. Move all
   protection-lowering decisions to tab/destination-bound extension-origin UI;
   script rejection/closed roots alone do not stop trusted-click redressing.
2. **RI-03/#356:** refresh the branch, fix red CI, run two fresh reviews;
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

After AI-20, restore only the exact tracked fixture (or implement the chosen
coverage-preserving rewrite), normalize the RI worktree dependencies, and run
the full typecheck/lint/build/unit/perf/relevant-E2E gates. Then continue RI-01
as a separate integration slice: service-worker handlers, extension-sender and
active-tab checks, exact-context delivery, popup actions, warn/cancel-only
injected UI, and explicit expiry cleanup. With stale #273 and #399 closed, keep
the RI checkpoint branch backup-only until the integration slice, full gates,
two fresh durably recorded adversarial reviews, and Gate-3 are complete.

## Reliability notes

- The current environment did not perform real Chrome behavior, CWS submission,
  real-feed building, external audit, or trademark/legal clearance.
- Treat successful CI as regression evidence, not efficacy evidence.
- Update shared branches with `git merge main`, never rebase; do not discard work
  or rewrite history without the explain-and-approve protocol.
- Do not edit `extension/dist/` or generated data directly.
