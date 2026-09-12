<!-- HUMAN QUEUE: Use stable AI-N identifiers for human decisions or manual checks.
     Close an item only from an explicit owner answer or directly verified removal
     of the action it requested. -->

# ACTION ITEMS — Human-Owned Tasks (NavSentinel)

**OPEN: AI-45 — Protection Center export preview.** The #591 follow-up opens a
reviewable snapshot before saving a local evidence file. The owner Chrome check
is [the export review procedure](docs/vision-overhaul/EXPORT_REVIEW.md#human-chrome-check--ai-45).
Automated renderer and disposable-extension tests are not human acceptance.
Record the candidate Git head and Chrome version with the result. This item does
not change the guided-resolution cursor.

**Purpose:** the concise, durable register for human decisions and manual checks.
It is not a live GitHub snapshot: re-check Git, GitHub, and product checks before
acting. `docs/Project_Roadmap.md` holds execution work; archive material is
provenance only. Detailed retired procedures moved to
[`docs/archive/ACTION_ITEMS_HISTORY_2026-08-12.md`](docs/archive/ACTION_ITEMS_HISTORY_2026-08-12.md).

## Current snapshot

**Browser-gate index refreshed 2026-09-12:** Chris explicitly authorized the
current named human-gated queue to merge before manual Chrome testing under
[`D-2026-09-12-P`](docs/agentic/DECISIONS.md), provided every non-human gate
still passes. The retained browser work is consolidated as AI-47 below; this is
not a human-test result. PR #599 remains outside pending AI-37's explicit
queue-policy choice, and PR #572 remains parked outside on SP-F-013.
Before that instruction, eleven open PRs carried branch-held
human Chrome gates: #572 (AI-31), #599 (AI-37), #600 (AI-38), #608 (AI-39),
#609 (AI-40), #636 (AI-41), #640 (AI-42), #643 (AI-43), #644 (AI-44),
#641 (AI-45), and #649 (AI-46). This is not the total open-PR count or a claim
that these candidates have completed their other checks. At that time their
procedures lived only inside their own PR branches; the remaining branch-held
pointers are listed below. AI-30, AI-33, AI-35, and AI-36 are now
**post-merge** checks: PRs #570, #582, #586, and #589 merged on 2026-08-27 and no
waiver record for those merges was found in `docs/agentic/DECISIONS.md`,
`HANDOFF.md`, this file, or `docs/Project_Roadmap.md`, so each check stays open
against current `main`. The earlier explicitly waived browser-surface PRs (#528,
#532, #535, #514, #534, #520, #521, #522, #526, #533, #542, and separately #531)
merged after refreshed exact-head CI and bounded review; that waiver is not a
real-Chrome pass and establishes no `measure:fp` or headed-measurement result,
and #223 remains open. AI-27, AI-28, and AI-29 are resolved; AI-14 remains
blocked for future measurement work.

PR #600 merged as `c8b1a70bef3c92600fdf7af3fb9fdc5e73b236f2` under the
one-time waiver. Its Chrome work is now a current-`main` AI-47 subprocedure,
not a branch-held item or a human-test pass.

PR #609 merged as `e35f5430660767d4998c8f4d727b38444f3f9b14` under the same
waiver. Its Back/Forward Cache Chrome work is now a current-`main` AI-47
subprocedure, not a branch-held item or a human-test pass.

**Guided resolution cursor:** `AI-19` (`Resume at: AI-19`; conversational label
`q-5`). Current ready order: AI-19 → AI-47 → optional AI-24 → AI-23 (low
priority). The branch-held pointers remain until their PRs actually merge. The
four older post-merge checks (AI-30, AI-33, AI-35, AI-36) are unordered
additions to that queue.

**Status vocabulary note:** issue #421's proposed `OPEN | HELD | BLOCKED` parser
enum was superseded by owner decision #499 (2026-07-31), which removed the
repository-local harness, its ACTION_ITEMS/HANDOFF parser, hooks, and CI. Do not
reintroduce parser, status-enum, hook, tier, or harness machinery through this
register.

## Recently resolved item detail

**RESOLVED: AI-29 - Issue #555 opt-in overlay-cleanup Gate-3.** On 2026-08-28,
Chris loaded PR #557's exact `ee804fa8d45f34284e073b7054cdc558b14b025d`
artifact, reported that overlay cleanup works as intended, accepted the remaining
regular redirect-card control regression, and explicitly authorized merge. The
Chrome version was not supplied. **Dismiss** and **Allow once** on an ordinary
redirect guard may remain visibly present but inert; this is a fail-closed UX and
accessibility regression, not an established navigation bypass, and is tracked
with the complete evidence boundary and repair oracle in #560. The historical
attempt records below are retained as at-the-time evidence and do not reopen the
completed gate. This PR-specific completion does not move the general guided-
resolution cursor from AI-19.

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
inert Dismiss. It also replaces page-realm mouse-coordinate and keyboard-key
accessors; the prior candidate consulted the poisoned mouse fields four times.
The current local candidate captures the required event, traversal, focus, list,
and geometry accessors at document start, uses the pristine path only to prove
host ownership, and resolves the owned control without consulting the poisoned
page accessors before relaying the same bounded token. This is automated candidate
evidence only. Keep AI-29 open until the pushed exact head has green hosted CI
and Chris repeats the exact-head guide.

**Latest human result (2026-08-28, PR #557 at
`c388c40fb8b7237f04c2d94295f3e0bc80d64e3a`): FAILED in the owner-loaded
real-world child frame.** Cleanup remained active, but trusted mouse and keyboard
activation left Dismiss and Undo visibly present and inert, with no corresponding
console exception. Read-only inspection confirmed enabled tokenized controls and
an initialized bridge. Differential build inspection then found that post-build
guard bytes had changed while the manifest retained the same Vite-generated
loader URL, which gives a long-lived unpacked Chrome profile no new resource
identity for the repaired guard even though fresh-profile Playwright reads the
current disk bytes. The current candidate content-addresses the loader after
post-processing, verifies that identity as a named CI contract, and requires a
new runtime guard revision in every relevant Playwright page/frame. This is
automated candidate evidence only. Keep AI-29 open until the pushed exact head
has green hosted CI and Chris owner-reloads that exact artifact and repeats the
control checks.

**Final owner result (2026-08-28, PR #557 at
`ee804fa8d45f34284e073b7054cdc558b14b025d`): PASSED with one accepted tracked
regression.** Owner testing accepted the
remaining rotating-site limitation but found one large Undo/Dismiss card per
media frame too obstructive. Overlay-cleanup recovery is now a small Undo-only
status that leaves after 2 seconds or the next trusted outside pointer
interaction; redirect and security prompts are unchanged. Synthetic Chrome
coverage proves the outside interaction still reaches the page, expiry does not
restore the attack, twelve mixed frames shed their notices, and a preserved
accessible player-error dialog becomes usable after the brief overlap. #593
tracks the non-reproducible hidden-media redirect observation and #594 tracks
any future high-confidence nuisance-dialog handling. Chris confirmed this exact
artifact works as intended and authorized merge. A regular redirect guard's
**Dismiss** and **Allow once** controls may be inert; Chris accepted that
fail-closed regression for this merge, and #560 now owns its combined hostile-
frame reproduction and repair.

## Open and blocked items

### Branch-held Gate-3 items

Each item below is defined **only** inside its own PR branch's `ACTION_ITEMS.md`
and the procedure named in its entry; `main` carries no procedure for them, so
this list is a pointer, not the gate. Read that procedure before acting and
verify the live PR head before building. Each remaining branch-held entry carries
its own historical snapshot head where applicable; former AI-38 and AI-40 are
instead current-`main` AI-47 subprocedures below. AI-42 through AI-46 were checked on
2026-09-10. Only Chris can complete these owner checks. This index update does
not resolve issue #639's owner decision about where future gate procedures should
live.

- **AI-31** — PR #572 (issue #566), branch `fix/issue566-modifier-authority`,
  exact head `e35a88e0a5ea24cf9c33d97b68ccfbeda57974bf`. Scope: trusted
  Ctrl/Cmd-click and middle-click keep modifier-click authority in the requested
  tab while synthetic reuse of the same events is refused. The PR is separately
  PARKED before this gate on failure record SP-F-013 (the ~1-in-50 rollback
  survivor); green CI is not containment evidence, so do not run the manual gate
  on the current head. Full procedure in that branch's
  `docs/agentic/GATE3_GUIDES.md`.
- **AI-37** — PR #599 (issue #523), branch
  `fix/issue523-unverified-clipboard-cap`, exact head
  `d6f6b7efa2dd83e6845d474eb059a81afce863d7`. Scope: an owner accept/reject of
  the #523 unverified-queue design, plus a bridge queue-pressure Chrome check
  that a benign clipboard write cannot suppress the trusted fake-verification
  warning. Full procedure in that branch's `docs/agentic/GATE3_GUIDES.md`.
- **AI-39** — PR #608 (issue #601), branch
  `feat/issue601-extension-origin-allow`, exact head
  `8b12ffbd3a76c0abdf8fbe8090980640a7bc50e5`. Scope: the protection-lowering
  Proceed-once action lives in the extension popup, opens the destination exactly
  once with a null opener, and stays fail-closed on replay, expiry, navigation,
  and another tab. This slice is stacked on #600 and must follow it. Full
  procedure in that branch's `docs/agentic/GATE3_GUIDES.md`.
- **AI-41** — PR #636 (issue #593), branch
  `fix/issue593-child-frame-location-20260904`, exact head
  `344ba6aea8ae0f8edfa108d42e3569598288cf2a`. Scope: a trusted click under a
  nearly transparent same-origin iframe no longer leaves the tab on the frame's
  cross-site destination, with the rollback notice and its Proceed action intact
  and the named benign controls still passing. It does not cover a child frame
  navigating itself, which stays out of model; the residue is issue #637. Full
  procedure in that branch's `docs/agentic/GATE3_GUIDES.md`.

- **AI-42** — PR #640, branch `codex/vision-overhaul`, exact head
  `f969735d8e735976db9f4f9a9bcf96d221ecd3f4`. Scope: Protection Center, its
  popup/Options entry points, themes, and minimized evidence export. Full
  [browser acceptance procedure](https://github.com/Chris0Jeky/NavSentinel/blob/f969735d8e735976db9f4f9a9bcf96d221ecd3f4/docs/vision-overhaul/BROWSER_ACCEPTANCE.md).
- **AI-43** — PR #643 (issue #558), branch `codex/wave-settings-20260908`,
  exact head `3067e38c640e88b9c265e7c2e841a70d86c2e8d4`. Scope: default
  autosave and explicit conflict choices. Full
  [settings procedure](https://github.com/Chris0Jeky/NavSentinel/blob/3067e38c640e88b9c265e7c2e841a70d86c2e8d4/docs/agentic/GATE3_558_SETTINGS_AUTOSAVE.md).
  Dependent fixes #655 and #658 must follow their parent and retain their added checks.
- **AI-44** — PR #644 (issue #585), branch `codex/wave-events-20260908`,
  exact head `c4507486753e5be3249fb5d43afa94bb8522bb76`. Scope: imported
  page-site validation and valid legacy popup fallback. Full
  [event association procedure](https://github.com/Chris0Jeky/NavSentinel/blob/c4507486753e5be3249fb5d43afa94bb8522bb76/docs/agentic/ISSUE_585_GATE3.md).
  Dependent IP-site fix #657 must follow its parent and retain its added checks.
- **AI-45** — PR #641 (issue #591), branch `codex/wave-evidence-20260908`,
  exact head `ae52f03a08553f8ab819245c05045b3644fefd75`. Scope: preview the
  exact local evidence snapshot before downloading it. Full
  [export review procedure](https://github.com/Chris0Jeky/NavSentinel/blob/ae52f03a08553f8ab819245c05045b3644fefd75/docs/vision-overhaul/EXPORT_REVIEW.md#human-chrome-check--ai-45).
  This is stacked on #640; AI-42 remains open and the parent must land first.
- **AI-46** — PR #649 (issue #637), branch `codex/wave-child-form-20260908`,
  exact head `56d06a11d1ad8d4b00391c3eca99645da0312279`. Scope: child-frame
  form target allowances. Full
  [child-form procedure](https://github.com/Chris0Jeky/NavSentinel/blob/56d06a11d1ad8d4b00391c3eca99645da0312279/docs/agentic/AI-46-issue637-child-form-target.md).
  This is stacked on #636; AI-41 remains open and the parent must land first.

### Merged Gate-3 work retained under AI-47

- **Former AI-38 — PR #600 (issue #560), merged as `c8b1a70`.** The
  isolated-world toast input fence and top-layer host remain subject to the
  [current-`main` AI-47 owned-controls subprocedure](docs/agentic/GATE3_GUIDES.md#ai-47-former-ai-38-pr-600-current-main-toast-control-subprocedure).
  Run it only against a current `main` build that contains that merge. Record
  its required AI-47 sub-result; it is not a standalone or consolidated
  Gate-3 pass.
- **Former AI-40 — PR #609 (issue #569), merged as
  `e35f5430660767d4998c8f4d727b38444f3f9b14`.** The Back/Forward Cache
  redirect-chain boundary remains subject to the
  [current-`main` AI-47 history subprocedure](docs/agentic/GATE3_GUIDES.md#ai-47-subprocedure-former-ai-40---609-stale-redirect-chain-boundary).
  Run it only against a current `main` build that contains that merge. Record
  its required AI-47 sub-result; it is not a standalone or consolidated
  Gate-3 pass.

**OPEN: AI-47 — September browser-queue consolidated post-merge Chrome check.**
On 2026-09-12 Chris explicitly directed the agent to merge the open PRs gated
behind human testing and retain the testing as one human TODO. The one-time
scope and exclusions are recorded in
[`D-2026-09-12-P`](docs/agentic/DECISIONS.md). This item is not evidence that
any branch-held Gate-3 passed. It applies only to named candidates that actually
merge after current-base conflict resolution, exact-head checks, review, and
stack ordering; record their merge commits here in the closeout sync. **This is
an index, not a shortened replacement procedure:** every step and evidence field
in each applicable current-`main` AI-47 subprocedure and branch-held exact guide
remains required. Record a sub-result for each former AI item before reporting
AI-47 as passed; one omitted sub-result keeps AI-47 open.

Build the then-current `main`, record its 40-character SHA, and have Chris load
or reload that exact `extension/dist` in a fresh branded-Chrome profile. Confirm
the current page has capture and bridge markers `"1"` and the exact guard
revision printed by the build, then run this consolidated sequence:

1. **Owned controls (#600 / former AI-38):** complete the linked current-`main`
   subprocedure, including mouse and keyboard Dismiss and Undo, zero page-owned
   input reactions, and proof that a later hostile page layer cannot cover the
   extension host.
2. **Proceed authority (#608 / former AI-39):** complete the exact AI-39 guide.
   Page-injected UI remains warn/dismiss only; Proceed once lives in the
   extension popup, shows only the bounded origin/countdown presentation, opens
   exactly once with a null opener, and remains fail-closed after replay,
   expiry, navigation, or use from another tab. Confirm path/query/fragment data
   is absent from `chrome.storage.session`, popup DOM, and relevant consoles.
3. **History and redirect freshness (#609 / former AI-40):** complete the
   [exact former AI-40 guide retained as this AI-47 subprocedure](docs/agentic/GATE3_GUIDES.md#ai-47-subprocedure-former-ai-40---609-stale-redirect-chain-boundary). A real
   Back/Forward Cache restore inherits no stale redirect-chain factors, and the
   same factors expire without a navigation. A reload is not an equivalent
   check.
4. **Child-frame authority (#636/#649 / former AI-41/46):** complete both exact
   guides. The transparent child-frame navigation case is contained with its
   deliberate Proceed path intact; the normal declared-form and Back paths stay
   compatible; changed, replayed, or unrelated form targets remain denied.
5. **Protection Center and export (#640/#641 / former AI-42/45):** complete both
   exact guides, including popup/Options entry points, themes, category states,
   keyboard operation, cancel paths, preview/download byte parity, minimized
   export privacy, and the absence of page-injected Allow/Proceed controls.
6. **Settings concurrency (#643/#655/#658 / former AI-43):** complete the exact
   AI-43 guide and the child-PR additions. Default autosave,
   explicit conflicts, imported integer log limit `55`, same-field collision,
   disjoint-window merge, and preservation of the losing draft all match the
   active guide.
7. **Event association (#644/#657 / former AI-44):** complete the exact AI-44
   guide and the child-PR addition. Imported event `pageSite` validation,
   full-URL sanitization, legacy popup fallback, and canonical IP-site
   association remain correct without leaking an event to an unrelated
   top-level page.

Inspect page, popup, Options, Protection Center, and service-worker consoles for
new errors during the relevant steps. Report `AI-47 done; consolidated Gate-3
passed on main at <40-character SHA>; Chrome <version>` or `AI-47 failed on main
at <SHA>: <numbered step and observed result>`. A failure reopens the smallest
affected issue/PR slice; it does not invalidate unrelated checks. The general
guided cursor remains AI-19.

**OPEN: AI-36 — #558 popup/Options patch-save synchronization post-merge
Gate-3.** This is no longer a pre-merge gate. PR #589 merged on 2026-08-27 (head
`ee75bf408e04f528b0ee08006471f318fba3ef96`, merge commit
`003905094982b9a772cc5f06fe504d372c99dd6b`) and **no waiver record for that merge
was found** in `docs/agentic/DECISIONS.md`, `HANDOFF.md`, this file, or
`docs/Project_Roadmap.md`; no waiver or owner decision is claimed. Run the active
manual Chrome guide in [`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md)
against current `main`. Build that exact head, then load that build in a fresh
Chrome profile. Keep one valid Options field dirty, change both protection modes in the
popup, and confirm the clean Options controls update live without discarding the
dirty field. Save from Options and confirm the popup changes survive. Inspect
Options, popup, and service-worker consoles. This gate covers the bounded
patch-save/live-sync slice, not #558's remaining auto-save preference, dirty-state
warning, or same-field conflict UX. Only Chris can complete this human Gate-3.
The AI-36 guide carries a matching post-merge banner. Reply `AI-36 done; Gate-3
passed on main at <40-character SHA>; Chrome <version>` or `AI-36 failed on main
at <SHA>: <step and observed>`.
The general guided resolution cursor remains AI-19; AI-36 is an additional
branch-specific gate.

**OPEN: AI-35 — #539 cross-host child-event attribution post-merge Gate-3.**
This is no longer a pre-merge gate. PR #586 merged on 2026-08-27 (head
`96be8e09cfe51168e4231625154ed366a408940b`, merge commit
`b68f403a7f14379305cf1376f3ee4f188ef31493`) and **no waiver record for that merge
was found** in `docs/agentic/DECISIONS.md`, `HANDOFF.md`, this file, or
`docs/Project_Roadmap.md`; no waiver or owner decision is claimed. Run the active
manual Chrome guide in [`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md)
against current `main`. Build that exact head, load that build in a fresh Chrome
profile, and confirm a cross-host child-frame event keeps its emitting `site`
while the popup associates it with the top-level page; also confirm an unrelated
top-level page does not inherit the event. Inspect page, popup, and service-worker
consoles. Only Chris can complete this human Gate-3. The AI-35 guide carries a
matching post-merge banner. Reply `AI-35 done; Gate-3 passed on main at
<40-character SHA>; Chrome <version>` or `AI-35 failed on main at <SHA>: <step
and observed>`. The general guided
resolution cursor remains AI-19; AI-35 is an additional branch-specific gate.

**OPEN: AI-33 — Issue #530 popup trust-pill contrast post-merge Gate-3.** This
is no longer a pre-merge gate. PR #582 merged on 2026-08-27 (head
`02b8e5c4504ff5127a9b6c4af7cf8cc30fd07da2`, merge commit
`d1895b51763a6c6b7b5280f0ea80664d2f0c796d`) and **no waiver record for that merge
was found** in `docs/agentic/DECISIONS.md`, `HANDOFF.md`, this file, or
`docs/Project_Roadmap.md`; no waiver or owner decision is claimed. Build the
current `main` head and follow the active AI-33 procedure in
[`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md). Verify the
observing and trusted labels remain readable, visibly distinct from signal
chips, unclipped, keyboard-operable, and free of new popup-console errors. Only
Chris can record this complete. Reply `AI-33 done; Gate-3 passed on main at
<40-character SHA>; Chrome <version>` or `AI-33 failed on main at <SHA>:
<step and observed>`. This PR-specific gate does not move the general guided-
resolution cursor from AI-19.

**OPEN: AI-30 - #567 Back/Forward history-integrity post-merge Gate-3.** This is
no longer a pre-merge gate. PR #570 merged on 2026-08-27 (head
`20fad0ac9d19bcbe3a1ca6b2d43ab14c7438ce53`, merge commit
`ff063a677b6c633c1eca4955dbfe9b277e529f3a`) and **no waiver record for that merge
was found** in `docs/agentic/DECISIONS.md`, `HANDOFF.md`, this file, or
`docs/Project_Roadmap.md`; no waiver or owner decision is claimed. Build the
current `main` head and follow the active AI-30 procedure in
[`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md). Verify that a
cross-site local P -> A -> B history remains intact after ordinary navigation
allowances expire: Back stays on A, Forward returns to B, and two Back actions
reach A then P without a NavSentinel rollback, skipped entry, or unexpected
prompt. Also confirm the existing delayed page-initiated redirect still rolls
back. Only Chris can record this complete. Reply `AI-30 done; Gate-3 passed on
main at <40-character SHA>; Chrome <version>` or `AI-30 failed on main at
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

- AI-29 - resolved 2026-08-28: Chris accepted PR #557's exact `ee804fa` overlay
  behavior and authorized merge; the PR merged as
  `d132eace0d2b7e905d5d6eb5ad4c831236f925b2`, closing #555, #559, and #568. #560
  retains the accepted regular redirect-card Dismiss/Allow-once regression.
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
