# NavSentinel handoff

Updated 2026-08-01. This is an optional short snapshot; live Git/GitHub state,
product tests, `docs/Project_Roadmap.md`, and `ACTION_ITEMS.md` are authoritative.
Historical cycle detail remains in `ORCHESTRATOR.md` and is not required reading.

## Current development lanes

- **PR #509 merged** as `3faeb1e`, closing #321 and implementing AI-9's
  interaction-only release profile. **AI-25 passed** on executable/artifact
  head `f6815be` in headed Chrome
  150.0.7871.187: extension and service-worker registration, corrected
  onboarding, delayed-redirect rollback, credential interception, and both
  consoles passed without reputation-load or new runtime errors. The default
  artifact has no reputation runtime, asset, manifest exposure, or static HTML
  claim; the deterministic reputation fixture is available only through a
  non-release unpacked research profile.
- **RI-01 checkpoint** is remotely backed at `184be55`. AI-20 is resolved:
  Chris chose to leave the original fixture quarantined, and a runtime-equivalent
  representation passed an exact-file Defender scan plus the full old-branch
  gates. The branch is still 217 commits behind current `main`, RI-01 remains
  incomplete, and this is not a merge-ready PR.

## Human queue

Resume at **AI-19** (`q-5`). Ready order:

1. **AI-19:** clear or replace the product name before CWS submission.
2. **AI-24:** optional real-Chrome confirmation of the three waived browser checks.
3. **AI-23:** prune old worktrees/branches after preserving any unique outputs.

Blocked: **AI-15**, **AI-8**, and **AI-14**. Their replacement slices need
focused product checks, hosted product CI, and current human guides. AI-9 is
decided; AI-17 records Chris's accepted no-branch-protection posture and is not
an action or warning. AI-18 is obsolete because #499 removed project hooks.

## Product posture

- v0.4.0 remains a private pre-release alpha with no tag, GitHub release, CWS
  release, or external-user evidence. Chris accepts the current GitHub posture
  without branch protection under AI-17; do not re-flag it.
- The extension is local-first. Merged PR #509 makes interaction-only the release
  default. Its deterministic reputation fixture is research-only and cannot be
  packaged or released.
- Release integrity still requires extension-origin decision authority, removal
  of visual-sim and fake DNR surfaces, purpose-specific data minimization,
  beta-off broad JS behavior, and bridge identity/recovery work.
- Browser-surface changes still require the human Gate-3 decision or an explicit
  waiver. Test/Gym-only, dependency-only, and documentation changes do not.

## Verification caveats

- Successful CI is regression evidence, not open-web efficacy, compatibility,
  competitor superiority, or an external security audit.
- The RI-01 checkpoint passed typecheck, lint, build, version/package, perf,
  2,887 unit tests, and 65 E2E tests after fixing a trusted-click scoring
  regression found by the full E2E run. Its rewritten fixture passed an
  exact-file Defender scan. Those old-base results do not replace reconciliation
  with current `main`, exact-head checks, review, or real-Chrome Gate-3 before a
  future RI-01 merge.
- Real Chrome Gate-3 was performed for PR #509. CWS submission, real-feed
  building, external audit, and legal name clearance have not been performed.

## Next sequence

Continue the guided human queue at AI-19. Separately, refresh the RI-01 branch
from current `main`, finish the remaining authority path, and rerun scoped
checks plus real-Chrome Gate-3 before opening a merge-ready PR; do not delete its
worktree as AI-23 housekeeping.
