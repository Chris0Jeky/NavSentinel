# Development architecture reconciliation

Captured 2026-08-30 before GitHub administration. Live repository and GitHub
state override the dated proposal.

## Reconciliation baseline

| Fact | Package snapshot | Live evidence used for setup |
| --- | --- | --- |
| `main` | `302700e88004e831c4b6f0a78eb1a9c84184ec8d` (PR #598 merge) | `22377604a363141fc6e99a45800beca868307764` (PR #604 merge) |
| Open issues | 82 | 82 |
| Open PRs | #572, #599, #600 | #572, #599, #600, #605 |
| Milestones | beta: 6; Horizon: 15; unmilestoned: 61 | unchanged before administration |
| Security mappings on `main` | 63; #599 proposed 64 | 64 on `main`; #605 proposes 65 |
| Held external destinations | 21 | 21 on `main`; #605 proposes removal of 12 holds |

The package manifest contains 38 entries. Every listed byte count and SHA-256
matched the mounted files. Its JSON/CSV validation claims were independently
rechecked: 82 unique issue rows, proposed groups sum to 82, and the snapshot
milestone split is 6/15/61.

## New and changed pull-request facts

- #602 merged the bounded #186 bridge-peer ordering model.
- #603 merged the egress-fenced evidence repair and superseded the unfenced
  network fields from #602.
- #604 merged the docs closeout, bringing `main` to `2237760`.
- #605 is a new test-only #449 vertical. At head
  `1c82890ff3a90404c7c1a585b6660a46c815fb8a`, hosted lint/typecheck passed but
  Build / Unit failed one existing mutation-monitor assertion: expected at
  least 45 alerts and observed 1. E2E was skipped. This is tracked by #595.
- #572 and #599 are merge-conflicted (`dirty`) against current `main`; #572
  remains parked before AI-31 on SP-F-013. #600 is clean with green hosted
  Build / Unit and E2E, but its owner browser gate remains open.

No issue opened or closed between the package snapshot and this refresh; the
open-issue set is still the same 82 records.

## Package decisions accepted

- Outcome-based milestones M0–M5 plus maintenance icebox and frozen R1.
- Only M0/M1 active; #417 is the bounded methodology exception.
- Active Proving Ground #449 moves out of frozen Horizon.
- Interaction-only release truth for #415/#416/#127.
- Bounded local evidence, independent harm oracles, trusted input, explicit
  invalidity, and evidence downgrade.
- Extension-origin protection-lowering authority and frozen post-beta options.
- One short tracked architecture head; the detailed dated package stays outside
  required reading.

## Decisions changed or qualified

- **#458:** do not close. PR #534 removed the ineffective wrappers and added
  bundled-Chromium boundary/rollback coverage, but explicitly did not verify
  minimum supported Chrome, branded stable Chrome, or a manual Gate-3. Rebody
  to that residual and classify in M0.
- **#176:** keep in M1 after code re-audit. Exact URLs remain in session-backed
  last-URL, rollback/forward, and OAuth state for correctness, with mixed TTL
  and lifecycle rules. The required purpose/precision/TTL inventory is open.
- **#421/#422:** close as enacted/superseded only after the new icebox and
  architecture routing exist; #437 retains the unfinished roadmap/orchestrator
  rotation. The strict ACTION_ITEMS <200-line aspiration is not claimed.
- **#560:** move to M2 but leave its body intact while #600 remains open.
- **#523:** move to M1 but do not close; #599 still needs owner policy,
  exact-head branded Chrome, conflict resolution, and merge.
- **Labels:** create only the track/gate/state vocabulary actually applied in
  this migration, not every suggested evidence label.

## Verified stale-premise dispositions

- #244 is absorbed by #452; #245/#246 are absorbed by #444. Their successor
  bodies already preserve the native/offscreen/semantic/visual design scope and
  keep it frozen behind explicit promotion.
- #374 is obsolete after RI-02 excision and the restored 66 KB capture budget;
  closure still waits for an exact current build/performance run in this setup.
- #439 duplicates the now-active #449 proof programme plus #420's owner-machine
  browser lane. Its one-time ratification requirement must be preserved before close.
- #239 is stale because #574/#576 added and hardened silent-decision emissions;
  only ignore/timeout and complete distribution coverage remain.
- #415/#416/#426/#127 still carry the pre-interaction-only or invalid-corpus
  premise and require current bodies before movement.
- #474's unified reset shipped in #535, but the owner-selected lane boundary,
  navigation-category/cooldown disposition, and recorded residuals keep it open.
- #339 still has bounded residuals; #374 is no longer their blanket prerequisite.
  Rebody to accepted maintenance activation conditions rather than silently close.

## Authority and gate preservation

- No runtime source, manifest permission, release profile, network behaviour,
  storage schema, generated `extension/dist`, scenario snapshot, or evidence
  state is changed by setup.
- `ACTION_ITEMS.md` remains the only human queue; its cursor remains AI-19.
- No owner decision, Chrome result, external review, release, tag, CWS
  submission, or product claim is inferred.

## Tool/environment notes

The global estate registry path named by the working agreement was absent; the
available `~/.codex/REPOS.md`, repository authority files, exact remote, and
live API were used instead. The first GraphQL inventory hit a quota error; the
authenticated REST API then returned a full 5,000-request core allowance and
was used for all recorded facts. The primary checkout's Defender-quarantined
`tests/clickfix-detector.property.test.ts` deletion was preserved and isolated
from this branch in a detached-origin worktree.

## Administration status

Not yet applied at this reconciliation commit. No bulk GitHub write is
authorized from cached package state; each issue will be re-read immediately
before mutation and the final before/after receipt will record exact results.
