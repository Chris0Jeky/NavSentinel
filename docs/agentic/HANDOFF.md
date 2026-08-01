# NavSentinel handoff

Updated 2026-08-01. This is an optional short snapshot; live Git/GitHub state,
product tests, `docs/Project_Roadmap.md`, and `ACTION_ITEMS.md` are authoritative.
Historical cycle detail remains in `ORCHESTRATOR.md` and is not required reading.

## Current development lanes

- **PR #509** implements AI-9's interaction-only release profile. It is ready
  for review and intentionally unmerged until the current-head **AI-25** headed
  Chrome Gate-3 passes. The default artifact has no reputation runtime, asset,
  or manifest exposure; the deterministic reputation fixture is available only
  through a non-release unpacked research profile.

## Human queue

Resume at **AI-25** (`q-3`). Ready order:

1. **AI-25:** run PR #509's headed-Chrome Gate-3.
2. **AI-20:** decide the exact Defender-quarantined fixture disposition.
3. **AI-19:** clear or replace the product name before CWS submission.
4. **AI-24:** optional real-Chrome confirmation of the three waived browser checks.
5. **AI-23:** prune old worktrees/branches after preserving any unique outputs.

Blocked: **AI-15**, **AI-8**, and **AI-14**. Their replacement slices need
focused product checks, hosted product CI, and current human guides. AI-9 is
decided; AI-17 records Chris's accepted no-branch-protection posture and is not
an action or warning. AI-18 is obsolete because #499 removed project hooks.

## Product posture

- v0.4.0 remains a private pre-release alpha with no tag, GitHub release, CWS
  release, or external-user evidence. Chris accepts the current GitHub posture
  without branch protection under AI-17; do not re-flag it.
- The extension is local-first. PR #509 makes interaction-only the release
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
- On this Windows host, RW-06 failed at two different timing points across the
  full run and an isolated rerun; the other #498 popup case passed. Exact-head
  PR #509 Ubuntu E2E is green, and #498 owns the broader platform discrepancy.
- Real Chrome, CWS submission, real-feed building, external audit, and legal
  name clearance have not been performed in this session.

## Next sequence

Continue the guided human queue at AI-25. Do not merge PR #509 until that
current-head Gate-3 passes or Chris explicitly waives it. After #509 resolves,
continue at AI-20 and refresh other issue state before choosing an agent slice.
