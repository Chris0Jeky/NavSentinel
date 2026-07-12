# Session Handoff — NavSentinel

**Last updated:** 2026-07-10. Always refresh git/GitHub truth before acting.
`ACTION_ITEMS.md` holds the live human-facing snapshot without pinning a SHA;
the posture review's dated exact baseline is in `docs/Product_Strategy.md`.

This is the short next-loop entry point. Product direction is in
`docs/Product_Strategy.md`; execution gates are in `docs/Project_Roadmap.md`;
standing decisions are in `docs/agentic/DECISIONS.md`; human-only work is in
`ACTION_ITEMS.md`; historical cycle detail remains in `ORCHESTRATOR.md` pending
rotation under #437.

## Open human items — surface all of these

- **AI-19:** clear or replace the product name before CWS submission.
- **AI-18:** review/trust the project-local Codex hooks.
- **AI-17:** enable `main` branch protection.
- **AI-16:** ratify/amend the July 3 + July 10 standing decisions.
- **AI-9:** choose interaction-only or real-filter beta profile.
- **AI-15: BLOCKED** until agent preflight is complete.
- **AI-8 / AI-13 / AI-14: BLOCKED** pending current branches, two fresh reviews,
  green CI, and replacement human guides.

## Verified state

- v0.4.0; no tag, GitHub release, CWS release, branch protection, or external-
  user evidence.
- Main: typecheck, lint, build, version check, 2,874 unit tests (95 files), perf
  12/12, smoke E2E, and current GitHub CI green.
- 74 open issues with no milestone/assignee; 15 Horizon issues #439–#453 are a
  frozen option portfolio, not active work.
- Open PRs at WIP cap 3: #273 (255 commits behind), #356 (159 behind and E2E
  red), #399 (draft, 70 behind). Human Gate-3 would be premature.
- Package is about 474/500KB while reputation is a 52-byte test fixture. The
  old 150KB/100K-domain plan cannot meet its stated 0.01% FP target or aggregate
  package cap as written.

## Release blockers in order

1. **RI-01:** page-injected UI currently authorizes allow/trust/resume. Move all
   protection-lowering decisions to tab/destination-bound extension-origin UI;
   script rejection/closed roots alone do not stop trusted-click redressing.
2. **RI-03/#356:** refresh branches, fix red CI, run two fresh reviews; recreate
   or defer #273 and keep #399 outside the beta blocker set.
3. **RI-02/#424:** excise visual-sim. It has no production match path and can
   process a different active tab's pixels.
4. **RI-05/RI-06:** remove fake DNR; apply purpose-specific URL/data
   minimization, TTLs, controls, and complete behavioral reset.
5. **RI-07:** add the explicit beta capability profile and prove broad JS
   behavior wrappers are off while core navigation protection remains active.
6. **AI-9:** implement the chosen beta profile; the recommended default is
   interaction-only with no reputation claim.
7. **AI-19 + CWS:** settle name, then re-verify one canonical store/privacy copy,
   assets, permissions, fresh install, and package.
8. Run the current headed regression checklist, submit unlisted, and recruit the
   first 10-user cohort.

Before public launch, complete #175/#186 plus an external security review and
publish valid corpus, quietness, and current-browser comparative evidence.

## Next safe slice

Prepare and review RI-01 locally as one browser-surface security slice. The
three human-gated PR slots are already occupied, so do not open another PR until
one stale branch is closed/deferred or Chris changes the cap. Acceptance: injected UI
is warn/cancel only; pending actions are tab/destination-bound with a short TTL;
only extension-origin popup/options UI can proceed/allow/trust/resume; synthetic
input, trusted-click redressing, host mutation/removal, tab switching, and stale
pending state cannot lower protection. Two independent adversarial reviews and
Gate-3 are required.

## Reliability notes

- The current environment did not perform real Chrome behavior, CWS submission,
  real-feed building, external audit, or trademark/legal clearance.
- Treat successful CI as regression evidence, not efficacy evidence.
- Update shared branches with `git merge main`, never rebase; do not discard work
  or rewrite history without the explain-and-approve protocol.
- Do not edit `extension/dist/` or generated data directly.
