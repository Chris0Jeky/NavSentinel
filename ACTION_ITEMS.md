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
are resolved; AI-14 remains blocked for future measurement work. AI-29 now holds
issue #555's opt-in overlay-cleanup browser behavior for an exact-head Gate-3;
AI-30 holds issue #567's Back/Forward history-integrity fix; and AI-33 holds
issue #530's popup trust-pill contrast change for an exact-head visual Gate-3.

**Guided resolution cursor:** `AI-19` (`Resume at: AI-19`; conversational label
`q-5`). Current ready order: AI-19 → optional AI-24 → AI-23 (low priority).

**Status vocabulary note:** issue #421's proposed `OPEN | HELD | BLOCKED` parser
enum was superseded by owner decision #499 (2026-07-31), which removed the
repository-local harness, its ACTION_ITEMS/HANDOFF parser, hooks, and CI. Do not
reintroduce parser, status-enum, hook, tier, or harness machinery through this
register.

## Open and blocked items

**OPEN: AI-29 - Issue #555 opt-in overlay-cleanup Gate-3.** After the
implementation PR is ready, exact-head local checks and hosted CI are green,
build that same head, load `extension/dist` unpacked in a fresh temporary Chrome
profile, and follow the active AI-29 procedure in
[`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md). Verify the setting
defaults off, persists when enabled, hides only the attack fixtures, exposes a
working Undo, leaves the disabled/Navigation Off cases and benign overlays
usable, and adds no unexpected console errors. Only Chris can record this
complete. Reply `AI-29 done; Gate-3 passed on PR #<n> at <40-character SHA>;
Chrome <version>` or `AI-29 failed on PR #<n> at <SHA>: <step and observed>`.
This PR-specific gate does not move the general guided-resolution cursor from
AI-19.

**Earlier human result (2026-08-27, PR #557 at
`14e397b154f50b5ea8e1e30ca211404e8cf34bca`): FAILED at step 5.** In a fresh
Chrome profile, Chris confirmed the setting survives save/reopen and works by
keyboard; mutation-01 is hidden when cleanup is enabled and Undo works;
Navigation Off leaves cleanup inert; and the legitimate modal/video fixtures
remain usable. On `evasion-02-size-34pct.html`, NavSentinel blocked the new tab
but did not hide the deceptive overlay or expose the expected cleanup Undo.
Console status was not reported. Keep AI-29 open until the real-Chrome mismatch
is fixed and the new exact head passes the active procedure.

**Latest human result (2026-08-27, PR #557 at
`e8f5fafc9270a54acc510909cf670b1610cab55e`): FAILED the clarified automatic
cleanup outcome.** After rebuilding/reloading the unpacked extension in the
fresh profile, the popup showed cleanup enabled but the initial pink
`evasion-02-size-34pct.html` trap remained over **Real Link** until Chris clicked
it. The click-time fallback then correctly blocked `evil.example.com`, hid the
trap, and showed `Blocked new tab (overlay hidden)` with Undo. This proves the
reactive repair but not the requested pre-click behavior. Keep AI-29 open until a
new exact head hides the settled initial trap before interaction and passes the
revised active guide.

**Subsequent exploratory real-world finding (2026-08-27):** a media embed used a
non-qualifying outer iframe (`z-index:auto`) around a fixed maximum-z-index iframe
attached directly below the child document's `<html>`; the innermost static
`#container` disappeared when hidden manually. The prior top-frame-only automatic
monitor could not reach the qualifying middle node. The current candidate adds
bounded opt-in child-frame monitoring, direct-`<html>` discovery, isolated-world
self-UI exclusion, and an exact synthetic plus twelve-frame stress matrix. This is
automated candidate evidence, not a human Gate-3 completion; keep AI-29 open.

**Earlier human result (2026-08-27, PR #557 at
`f17dae0d9ad0573d73140784b76e377c2667c7eb`): FAILED on persistent real-world
cleanup.** Across four visible media embeds, cleanup was inconsistent after
reload and scroll. Direct inspection of one initialized child frame showed the
first layer become hidden at about 0.3 seconds, then a page rewrite/replacement
made both a full-player layer and a maximum-z-index child iframe visible again at
about 2 seconds; they stayed visible for the remaining 15-second observation
while the success card remained. Clicking NavSentinel's own **Dismiss** also
reached a page-level click handler and produced a blocked-popup notice. This
invalidates the prior E2E oracle, which stopped at the first hidden sample. The
subsequent repair uses an independently bounded, persistent cleanup lane, retains
one grouped Undo across replacement and independently delayed layers, and records
local cleanup outcomes. Its hostile fixture first failed on the old head and now
stays hidden across alert flooding, style rewrite, node replacement, and scroll
reinsertion.

**Latest human result (2026-08-27, PR #557 at
`661f97f2d164535686e8650b8ec09434bf8b08ba`): CORE PERSISTENCE PASSED; Gate-3
step 8 still FAILED.** After loading the correct build, Chris reported that the
real multi-embed page worked flawlessly across the prior recurrence paths and
accepted the suppression behavior. Clicking NavSentinel's **Dismiss**, however,
still reached the hostile child frame and briefly produced another blocked-click
notice. A stronger capture-phase fixture reproduces the escape against that head.
The current local repair candidate installs the toast input fence synchronously
before the MAIN bundle's asynchronous import and has red-to-green mouse Dismiss
and keyboard Undo coverage with every page input counter held at zero. This is
automated candidate evidence
only. Keep AI-29 open until the pushed exact head has green hosted CI and Chris
repeats the exact-head guide.

**Latest human result (2026-08-28, PR #557 at
`848d613ec74b9a1d1b9e026163f06585e9fc23d2`): FAILED the repaired control
action.** The overlay remained suppressed and the document-start fence stopped
the hostile-frame reaction, but both **Dismiss** and **Undo** became inert with
no corresponding console error. Read-only inspection of the live child frame
confirmed that the controls were enabled and held valid action tokens while the
verified MAIN-to-isolated bridge was otherwise active. A red synthetic case now
retargets the realm-visible event path to the extension host and reproduces the
inert Dismiss. The current local candidate uses a pristine host path only to
prove extension ownership, then resolves mouse controls by owned shadow-root
bounds and keyboard controls by shadow-root focus before relaying the same
bounded token. This is automated candidate evidence only. Keep AI-29 open until
the pushed exact head has green hosted CI and Chris repeats the exact-head guide.

**OPEN: AI-36 — #558 popup/Options patch-save synchronization Gate-3.** Run the
active manual Chrome guide in [`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md)
against the eventual PR for branch `fix/issue558-patch-save-sync`. Verify the
exact head and hosted checks first, then load that exact build in a fresh Chrome
profile. Keep one valid Options field dirty, change both protection modes in the
popup, and confirm the clean Options controls update live without discarding the
dirty field. Save from Options and confirm the popup changes survive. Inspect
Options, popup, and service-worker consoles. This gate covers the bounded
patch-save/live-sync slice, not #558's remaining auto-save preference, dirty-state
warning, or same-field conflict UX. Only Chris can complete this human Gate-3.
The general guided resolution cursor remains AI-19; AI-36 is an additional
branch-specific gate.

**OPEN: AI-35 — #539 cross-host child-event attribution Gate-3.** Run the
active manual Chrome guide in [`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md)
against the eventual PR for branch `fix/issue539-page-attribution`. Verify the
exact head and hosted checks first, then load that exact build in a fresh Chrome
profile and confirm a cross-host child-frame event keeps its emitting `site`
while the popup associates it with the top-level page; also confirm an unrelated
top-level page does not inherit the event. Inspect page, popup, and service-worker
consoles. Only Chris can complete this human Gate-3. The general guided
resolution cursor remains AI-19; AI-35 is an additional branch-specific gate.

**OPEN: AI-33 — Issue #530 popup trust-pill contrast Gate-3.** After the
implementation PR is ready and exact-head automated checks are green, build that
same head and follow the active AI-33 procedure in
[`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md). Verify the
observing and trusted labels remain readable, visibly distinct from signal
chips, unclipped, keyboard-operable, and free of new popup-console errors. Only
Chris can record this complete. Reply `AI-33 done; Gate-3 passed on PR #<n> at
<40-character SHA>; Chrome <version>` or `AI-33 failed on PR #<n> at <SHA>:
<step and observed>`. This PR-specific gate does not move the general guided-
resolution cursor from AI-19.

**OPEN: AI-30 - PR #570 Back/Forward history-integrity Gate-3.** After every
automated check for the current PR head is green, build that same head and follow
the active AI-30 procedure in
[`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md). Verify that a
cross-site local P -> A -> B history remains intact after ordinary navigation
allowances expire: Back stays on A, Forward returns to B, and two Back actions
reach A then P without a NavSentinel rollback, skipped entry, or unexpected
prompt. Also confirm the existing delayed page-initiated redirect still rolls
back. Only Chris can record this complete. Reply `AI-30 done; Gate-3 passed on
PR #570 at <40-character SHA>; Chrome <version>` or `AI-30 failed on PR #570 at
<SHA>: <step and observed>`. This PR-specific gate does not move the general
guided-resolution cursor from AI-19.

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
<step and observed>`. Only Chris can record this complete. This is not a release blocker. See
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
