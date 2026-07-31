# NavSentinel handoff

Updated 2026-07-31. This is an optional short snapshot; live Git/GitHub state,
product tests, `docs/Project_Roadmap.md`, and `ACTION_ITEMS.md` are authoritative.
Historical cycle detail remains in `ORCHESTRATOR.md` and is not required reading.

## Current development lanes

- **#499 — repo-local harness retirement:** owner-directed. Removes project
  hooks/settings, tier, vendored floor, lifecycle scripts, validation commands,
  and Harness CI without touching product code or product CI. A fresh Codex
  session will have no project `PreToolUse` floor. Shared machine configuration
  remains unchanged. This supersedes #497's unpushed pin-revert commit.
- **#495 — Sharp advisory:** remote branch `fix/issue495-sharp` at `13a8a59`
  updates only
  `package.json`/lockfile to Sharp 0.35.3. Install, audit, typecheck, lint, build,
  package, and native SVG-to-PNG proof passed; independent review found no HIGH
  issue. Refresh from `main`, then publish.
- **#494 — dormant Phase 2 evidence:** remote branch
  `fix/issue494-phase2-repair` at `9e5fb1d` repairs three
  mutation fixture races. The CI-shaped lane records 20 passed plus two explicit
  `test.fixme` cases owned by #496; independent review is clean. Unrelated local
  Windows popup failures are tracked in #498.
- **#488 — Phase 2 selector:** parked branch `fix/issue488-phase2-lane` selects
  all 22 `@phase2` cases and resumes after #494 lands.

## Human queue

Resume at **AI-16** (`q-1`). Ready order:

1. **AI-16:** ratify or amend the July standing decisions.
2. **AI-9:** choose interaction-only or real-filter beta profile.
3. **AI-20:** decide the exact Defender-quarantined fixture disposition.
4. **AI-17:** enable `main` branch protection.
5. **AI-19:** clear or replace the product name before CWS submission.
6. **AI-24:** optional real-Chrome confirmation of the three waived browser checks.
7. **AI-23:** prune old worktrees/branches after preserving any unique outputs.

Blocked: **AI-15**, **AI-8**, and **AI-14**. Their replacement slices need
focused product checks, hosted product CI, and current human guides. AI-18 is
obsolete: #499 removes the project hooks, so no trust or restart confirmation
remains.

## Product posture

- v0.4.0 remains a private pre-release alpha with no tag, GitHub release, CWS
  release, external-user evidence, or branch protection.
- The extension is local-first; the bundled reputation asset is a test fixture,
  not real protection or evidence for a reputation claim.
- Release integrity still requires extension-origin decision authority, removal
  of visual-sim and fake DNR surfaces, purpose-specific data minimization,
  beta-off broad JS behavior, and bridge identity/recovery work.
- Browser-surface changes still require the human Gate-3 decision or an explicit
  waiver. Test/Gym-only, dependency-only, and documentation changes do not.

## Verification caveats

- Successful CI is regression evidence, not open-web efficacy, compatibility,
  competitor superiority, or an external security audit.
- On this Windows host, two unchanged default E2E popup cases fail while the
  exact current-main Ubuntu run is green; #498 owns the platform discrepancy.
- Real Chrome, CWS submission, real-feed building, external audit, and legal
  name clearance have not been performed in this session.

## Next sequence

Land #499, then publish #495, #494, and finally #488. Keep #496 and #498 as the
bounded follow-ups; do not fold them into those ready slices.
