# GitHub administration receipt

Applied 2026-08-30 against `Chris0Jeky/NavSentinel` after refreshing
`origin/main` at `22377604a363141fc6e99a45800beca868307764` and committing the
pre-write reconciliation as `0e974e6` on
`docs/development-architecture-20260830`.

This receipt records repository administration only. It does not claim that a
runtime fix, owner browser check, release, external review, or product outcome
was completed.

## Before and after

| Measure | Before | After |
| --- | ---: | ---: |
| Open issues | 82 | 75 |
| Open issues without a milestone | 61 | 0 |
| Outcome milestones | 2 | 8 |
| Routing labels | 0 | 14 |
| Stale issue bodies reconciled | 0 | 13 |
| Obsolete or absorbed issues closed | 0 | 7 |

The final issue sets were independently re-read through the GitHub REST API;
they match the tracked map exactly:

| Milestone | State | Open issues |
| --- | --- | ---: |
| `M0-proving-ground-foundation` | Active | 10 |
| `v0.5.0-unlisted-beta` | Active | 8 |
| `v0.5.1-interaction-integrity` | Planned | 12 |
| `v0.6.0-local-evidence-plane` | Planned | 8 |
| `EV-1-efficacy-and-quietness` | Planned | 14 |
| `BETA-1-cohort-and-operations` | Gated | 1 |
| `maintenance-icebox` | Passive | 4 |
| `post-beta-horizon` | Frozen | 18 |

Only M0 and M1 are active. Issue #417 retains the documented test-methodology
exception; that does not activate detector tuning in M4.

## Milestones and labels

Created milestones 3 through 8 and reconciled the descriptions of the two
existing milestones (1 and 2). No due dates were added.

Created only the routing vocabulary used by this migration:

- tracks: `proving-ground`, `release-integrity`, `interaction`, `evidence`,
  `measurement`, `operations`, `research`, and `maintenance`;
- gates: `browser`, `measurement`, and `owner`;
- states: `parked`, `frozen`, and `icebox`.

Every open issue has exactly one `track:*` label. The audited special-label
counts are: 18 frozen, 4 icebox, 1 parked, 8 owner-gated, 10 browser-gated, and
14 measurement-gated. No evidence-state labels were created.

## Body and history reconciliation

Rebodied #127, #176, #239, #243, #339, #415, #416, #419, #425, #426, #449,
#458, and #474. Each received a dated comment pointing to the preserved edit
history and this architecture branch.

Kept #560's current lifecycle body intact while PR #600 remains open. Added
explicit routing comments to #560, #566, #595, and #601 and preserved absorbed
scope in #420, #444, #449, and #452 before any closure.

## Closures

| Issue | State reason | Preserved successor or evidence |
| --- | --- | --- |
| #244 | Not planned | Native-companion design is absorbed by #452. |
| #245 | Not planned | On-device model design is absorbed by #444. |
| #246 | Not planned | Removed visual-sim premise; later semantics remain in #444. |
| #374 | Completed | Current build and all 12 performance budgets pass; visual-sim is absent and barred from return. |
| #421 | Completed | Operating posture enacted; remaining document rotation is #437. |
| #422 | Completed | Bounded discovery/priority posture enacted; maintenance milestone now exists. |
| #439 | Not planned | Active proof programme is #449; deterministic browser ownership is #420. |

#458 deliberately remains open in M0. PR #534 proved the repository Chromium
boundary but did not supply the issue's minimum/current branded-Chrome matrix.
#176 deliberately remains in M1 until URL purpose, precision, TTL, and lifecycle
are decided and proved. No human decision was inferred for #474, #523, or #601.

## Live pull-request facts retained

At the migration snapshot the four open PRs were:

- #572: conflict-dirty and parked before AI-31 on SP-F-013;
- #599: conflict-dirty with green hosted checks, but owner policy and branded
  Chrome gates still open;
- #600: clean with green hosted checks, but its owner media-page check open;
- #605: test-only fixture-localization slice, red in hosted run `33338605658`
  on the #595 mutation-monitor scarce-reserve assertion (expected at least 45,
  observed 1; 3,129 other unit tests passed; E2E/release skipped).

The #605 failure is tracked, not dismissed as flaky. It does not exercise or
block this documentation/admin branch.

## Local proof before closure

On the setup branch:

- `npm ci` completed with zero reported vulnerabilities;
- `npm run security:generate` regenerated eight deterministic views;
- `npm run security:check` validated 168 scenarios, 31 capabilities, 64
  mappings, 1,512 local work units, and all eight generated views;
- `npm run typecheck` passed;
- `npm run lint` passed;
- `npm run build` passed for `interaction-only`, `releaseEligible=true`;
- `npm run check:perf-budget` passed all 12 budgets, including
  `capture_isolated` at 65.4KB / 66KB.

Microsoft Defender keeps `tests/clickfix-detector.property.test.ts` absent in
this worktree. Its deletion is unrelated, unstaged, and excluded from every
commit. Local typecheck/lint therefore do not prove that quarantined path;
hosted CI on the complete pushed tree remains required. This receipt must not be
read as a release receipt.

## Preserved gates

- `ACTION_ITEMS.md` remains the only human queue and its cursor remains AI-19.
- No runtime file, permission, release profile, storage schema, network path,
  generated extension artifact, scenario outcome, or evidence state changed.
- No owner Chrome result, accessibility result, name decision, release signing,
  CWS submission, external review, or public claim was inferred.
