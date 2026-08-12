<!-- HUMAN QUEUE: Use stable AI-N identifiers for human decisions or manual checks.
     Close an item only from an explicit owner answer or directly verified removal
     of the action it requested. -->

# ACTION ITEMS — Human-Owned Tasks (NavSentinel)

**Purpose:** the concise, durable register for human decisions and manual checks.
It is not a live GitHub snapshot: re-check Git, GitHub, and product checks before
acting. `docs/Project_Roadmap.md` holds execution work; archive material is
provenance only. Detailed retired procedures moved to
[`docs/archive/ACTION_ITEMS_HISTORY_2026-08-12.md`](docs/archive/ACTION_ITEMS_HISTORY_2026-08-12.md).

## Current snapshot

**Snapshot recorded 2026-08-10:** the explicitly waived browser-surface PRs
#528, #532, #535, #514, #534, #520, #521, #522, #526, #533, and #542 merged
after refreshed exact-head CI and bounded review. That waiver is not a real-Chrome
pass. #531 separately merged under its own waiver; it does not establish a
`measure:fp` or headed-measurement result, and #223 remains open. AI-27 and AI-28
are resolved; AI-14 remains blocked for future measurement work.

**Guided resolution cursor:** `AI-19` (`Resume at: AI-19`; conversational label
`q-5`). Current ready order: AI-19 → optional AI-24 → AI-23 (low priority).

**Status vocabulary note:** issue #421's proposed `OPEN | HELD | BLOCKED` parser
enum was superseded by owner decision #499 (2026-07-31), which removed the
repository-local harness, its ACTION_ITEMS/HANDOFF parser, hooks, and CI. Do not
reintroduce parser, status-enum, hook, tier, or harness machinery through this
register.

## Open and blocked items

**OPEN: AI-19 — Clear or replace the working product name before CWS submission.**
TruNav publicly uses the exact name `NavSentinel` for a coming-soon GNSS
anti-spoofing receiver. This is a risk flag, not legal advice. Choose either
`AI-19 rename; generate shortlist` or `AI-19 keep; begin formal clearance`.
For either route, record the intended territories and goods/services, search
relevant trademark/product/store/domain/handle sources, retain dated results, and
obtain professional advice before a commercial or public launch. A rename must
coordinate product, store, asset, and repository names. Reply `AI-19 done:
<decision>` when complete.

**OPEN: AI-24 — Optional post-merge real-Chrome confirmation.** Build current
`main`, load `extension/dist` unpacked in a fresh temporary Chrome profile, and
check the merged #356/#464/#466 result: delayed redirect rollback and toast,
programmatic-submit block then exactly one allow-once action, Level-5 popunder
block, OAuth popup by physical click/Tab+Enter/submit input (exactly one popup and
no prompt), plus MV3 service-worker registration in `chrome://extensions`. Record
Chrome version and any unexpected result with `AI-24 done` or `AI-24 failed:
<step and observed>`. This is not a release blocker. See
[`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md) and the archive for
historical procedure provenance.

**BLOCKED: AI-15 — Headed release session.** Do not revive the withdrawn
one-sitting guide. It becomes actionable only after an agent supplies a current
preflight that resolves or deliberately defers RI-01, stale #273/AI-8, visual-sim
and fake DNR, RI-06 minimization/reset, RI-07 beta-off behavior, #175/#186 bridge
integrity, #455 consent, and a current headed checklist. Start with
`docs/Product_Strategy.md`.

**BLOCKED: AI-8 — Neutral-chip Gate-3 after closed PR #273.** Do not use the
stale branch guide. An agent must recreate or defer the change from current `main`,
resolve its preserved review findings, prove focused checks and hosted CI, then
provide a new visual-check guide.

**OPEN: AI-23 — Worktree and branch housekeeping (low priority).** No blanket
prune: each removal or deletion needs Chris's explicit approval for its exact path
or branch. Before requesting it, re-run `git worktree list --porcelain`, inspect
both ordinary and ignored status, prove the commit is merged or otherwise
preserved, and state an ignored-artifact preservation plan. Use plain
`git worktree remove` and `git branch -d` only after named approval.

The 2026-08-08 inspection recommends retiring `chore/deny-floor-v1.6.3` / the
`nav-floor-sync` worktree only after approval and ignored-cache preservation: all
three commits target repository-local harness surfaces deliberately removed by
owner decision #499. Retain the RI-01 and issue-496 worktrees; do not delete the
local-only `fix/user-activation-neutral-chip` branch because it preserves the
closed #273 intent. `fix/cooldown-map-cap` is recommended for owner-approved
retirement because its guarantee is already implemented differently on `main`.
Reply `AI-23 inspect nav-floor-sync`, `AI-23 retire nav-floor-sync`, or
`AI-23 done` only after the named decision and a fresh inventory.

**BLOCKED: AI-14 — OAuth tradeoff measurement after closed PR #399.** Keep #223
blocked until #417 supplies valid methodology and a current slice provides focused
checks, hosted CI, and a reproducible headed measurement plan. The owner waived
this hold for #531 only; that did not establish a real-Chrome, `measure:fp`, or
headed-measurement result and does not waive future methodology.

## Completed and superseded log

- AI-28 — resolved 2026-08-10: #535 records the behavioural-data reset boundary;
  it clears event log, prompt outcomes, adaptive scores, and domain profiles while
  preserving settings, allowlist, and trusted domains.
- AI-27 — resolved 2026-08-10: the eleven-PR browser queue merged under an
  explicit waiver; AI-24 remains the optional real-Chrome confirmation.
- AI-26 — no distinct register entry was ever created; its #514 Gate-3 residue is
  represented by AI-27/AI-24.
- AI-25 — done 2026-08-01: #509 interaction-only Gate-3 completed in Chrome.
- AI-22 and AI-21 — resolved 2026-07-25 under manual-gate waivers; their merged
  checks are consolidated into optional AI-24.
- AI-20 — done 2026-08-01: original Defender fixture remains quarantined; the
  runtime-equivalent replacement is scan-clean.
- AI-18 — resolved/superseded 2026-07-31: #499 removed the project-hook trust
  surface; no re-trust action remains.
- AI-17 — accepted 2026-08-01: Chris accepts `main` without branch protection.
- AI-16 — ratified 2026-08-01: July standing product/process decisions recorded.
- AI-13 — resolved 2026-07-25 under a manual-gate waiver; AI-24 owns optional
  merged-result confirmation.
- AI-12 — done 2026-06-23: top-site FP relief merged after manual confirmation.
- AI-11 — done 2026-06-23: toast count-pill merged.
- AI-10 — done 2026-06-23: SPA-breakage fix merged after manual Chrome check.
- AI-9 — decided 2026-08-01: interaction-only is the release-eligible default;
  research-reputation remains unpacked-only and non-release.
- AI-6, AI-5, AI-4, AI-3, AI-2, and AI-1 — resolved or superseded in June 2026;
  see the dated archive for decisions, waivers, and historical procedures.

## Provenance

This file deliberately retains one current snapshot, the open/blocked queue, and
one-line outcomes. Historical snapshots, resolved-item detail, original guides,
exact-head records, and superseded procedures are preserved in the dated archive;
they are not current operator guidance. `docs/agentic/ORCHESTRATOR.md` is also a
retired historical cycle ledger, not a living orchestrator.
