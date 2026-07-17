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
- **AI-13: OPEN / READY:** run the exact-head-guarded #356 Chrome Gate-3 guide;
  only Chris can record it complete.
- **AI-21: OPEN / CONDITIONAL:** run PR #464's exact-head-guarded synthetic
  navigation Chrome Gate-3 guide after live CI/review prechecks pass.
- **AI-15: BLOCKED** until agent preflight is complete.
- **AI-8 / AI-14: BLOCKED** pending current branches, two fresh reviews, green
  CI, and replacement human guides.

## Verified state

- v0.4.0; no tag, GitHub release, CWS release, classic branch protection,
  repository ruleset, or external-user evidence.
- GitHub private vulnerability reporting is enabled and `SECURITY.md` links the
  verified private advisory route.
- Root `main` is clean and matches `origin/main`; its current GitHub CI is green.
- 80 open issues with no milestone/assignee; 15 Horizon issues #439–#453 are a
  frozen option portfolio, not active work.
- Stale PRs #273 and #399 were closed on 2026-07-13 with re-entry paths and
  issue anchors preserved. Open PRs are #356, draft #457, #463, and #464.
- PR #356 exact guide head `ee0f9b7` is twice reviewed, thread-clean, and green
  in GitHub Build/Unit and E2E. AI-13 real-Chrome Gate-3 is its only remaining
  gate; do not merge without Chris's evidence.
- PR #463 exact head `91aab4f` is twice reviewed, thread-clean, audit-zero, and
  green in GitHub Build/Unit and E2E. It is open/ready but intentionally
  unmerged because the repository's aging rule is not yet satisfied.
- PR #464 rejects synthetic pointer/click authority without discarding a real
  pointerdown's risk evidence. Local exact-code proof includes typecheck, lint,
  build, targeted attack/compatibility E2E, three repeated Level 6 passes, and
  65/65 one-worker E2E. Its exact-head GitHub/review evidence must be checked on
  the PR after this handoff commit; AI-21 human Gate-3 remains mandatory.
- Package is about 474/500KB while reputation is a 52-byte test fixture. The
  old 150KB/100K-domain plan cannot meet its stated 0.01% FP target or aggregate
  package cap as written.
- Product-posture and guided-workflow work merged through PR #454; verify live
  `main` rather than pinning its SHA. The RI-01 checkpoint branch is remotely
  backed up without the unstaged Defender deletion; verify its SHA live. Its
  worktree remains dirty only because of the Defender-quarantined fixture.
- The RI-01 broker foundation is unit-tested but not wired into production.
  PR #464 changes only the synthetic-navigation authority sub-slice; it does
  not move allow/trust/resume into extension-origin UI or complete RI-01.

## Local review evidence

- **PR #464 pre-final adversarial round (two independent lenses, 2026-07-17):**
  the initial isolated commit regressed Level 6. One lens found that discarding
  the preceding trusted pointerdown removed retarget/fast-attempt evidence and
  could let a hidden synthetic `_blank` activation escape. The other reproduced
  the escaped tab and identified missing native-anchor and MAIN redirect
  coverage. Fixed in `aa9fa3a`: trusted-only `lastDown` remains correlation
  evidence, allowance writes remain gated by the current event's trust, the
  benign-anchor exemption now requires a trusted click, and the tests assert no
  popup plus SW/MAIN/native-anchor/redirect rejection. The fresh final round(s)
  and bot/thread accounting are authoritative only when posted against PR
  #464's live exact head; any later head invalidates them.

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

## Release blockers in order

1. **RI-01:** page-injected UI currently authorizes allow/trust/resume. Move all
   protection-lowering decisions to tab/destination-bound extension-origin UI;
   script rejection/closed roots alone do not stop trusted-click redressing.
2. **RI-03/#356:** complete AI-13 human Gate-3 on the current green head;
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

After PR #464's automated/review gates settle, take one narrow remaining RI-01
integration slice from a fresh worktree: service-worker pending-decision
handlers with extension-sender, active-tab, destination-context, TTL, and stale
state validation. Do not mix popup UI or credential-guard work into that slice.
The old dirty checkpoint worktree remains quarantined and untouched under AI-20;
use its clean remote backup only as read-only source material.

## Queue accounting

- **Open / human-held:** #356 (AI-13) and #464 (AI-21); neither may merge from
  automation alone.
- **Open / ready but aging:** #463; no red checks, unresolved threads, or known
  untracked debt remain at its recorded exact head.
- **Parked:** draft #457 agent-harness tooling; closed #273/#399 retain explicit
  re-entry paths.
- **Blocked:** AI-15, AI-8, and AI-14.
- **Deferred human decisions/actions:** AI-16 (resume cursor), AI-9, AI-20,
  AI-17, AI-19, AI-18, AI-13, and AI-21. No item was silently dropped or
  self-cleared.

## Reliability notes

- The current environment did not perform real Chrome behavior, CWS submission,
  real-feed building, external audit, or trademark/legal clearance.
- Treat successful CI as regression evidence, not efficacy evidence.
- Update shared branches with `git merge main`, never rebase; do not discard work
  or rewrite history without the explain-and-approve protocol.
- Do not edit `extension/dist/` or generated data directly.
