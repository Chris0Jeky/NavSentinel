# NavSentinel handoff

Updated 2026-09-04. This is an optional short snapshot; live Git/GitHub state,
product tests, `docs/Project_Roadmap.md`, and `ACTION_ITEMS.md` are authoritative.
Historical cycle detail remains in `ORCHESTRATOR.md` and is not required reading.

## 2026-09-04 live delta

`origin/main` is `a440e35` (PR #635 merged 2026-09-03T21:40Z; PRs #621-#635 were
the Codex agent's #449 evasion-locality chain plus #622/#623/#625). Six PRs are
open, all ready-for-review, all `MERGEABLE`/`CLEAN`, and every one held on a human
Chrome gate per `DECISIONS.md` D-2026-07-03-H. None may be merged by an agent.
This exceeds D-2026-07-03-D's WIP cap of three open human-gated PRs; no further
browser-surface PR should be opened until that queue drains. The test-only PR
#605 named in the 2026-08-30 delta merged on 2026-09-02 as
`4883a8eaef1b35ea176802ee8d0d97afbc854b81`, so its red-check item is closed.

| PR | Branch | Exact head | Gate | State |
| --- | --- | --- | --- | --- |
| #572 | `fix/issue566-modifier-authority` | `e35a88e0a5ea24cf9c33d97b68ccfbeda57974bf` | AI-31 | re-reconciled with `main` today; CI run 33821991601 success. Still PARKED before AI-31 on failure record SP-F-013 (the ~1-in-50 rollback survivor); green CI is not containment evidence |
| #599 | `fix/issue523-unverified-clipboard-cap` | `d6f6b7efa2dd83e6845d474eb059a81afce863d7` | AI-37 | re-reconciled today; CI run 33821845180 success, unit 3188/3188. Owner #523 queue-design decision and the bridge queue-pressure Chrome check remain open |
| #600 | `fix/issue560-isolated-input-fence` | `04470a5dc230b07f261c66213c2ba23770fc9cd3` | AI-38 | containment only; owner media-page Chrome check open |
| #608 | `feat/issue601-extension-origin-allow` | `8b12ffbd3a76c0abdf8fbe8090980640a7bc50e5` | AI-39 | stacked on #600 and must follow it |
| #609 | `fix/issue569-stale-redirect-chain` | `3f42f7d0ac5607b333433505419fc35593cd7c4e` | AI-40 | branded-Chrome BFCache check open |
| #636 | `fix/issue593-child-frame-location-20260904` | `344ba6aea8ae0f8edfa108d42e3569598288cf2a` | AI-41 | new today; CI run 33825137291 success; one adversarial review round done (a HIGH `href="#"` forgery bypass fixed and pinned by a new arm) |

PR #636 converts the parked #593 probe
(`origin/test/issue593-hidden-media-evidence-20260903` @ `cad5bfb`) into a green
regression: a child-frame trusted click now mints the tab-wide
`ns-nav-gesture`/`ns-allow-nav` windows only when the frame declared a
cross-document http(s) anchor or a form submit control, and gesture-less
child-initiated `top` navigation falls through to the existing rollback path. It
raised the `capture_isolated` perf budget 66 -> 67 KB (the research-reputation
profile was at ~0.1 KB headroom). Limits, stated plainly: the signal is forgeable
by a `<form><button>` that `preventDefault()`s then scripts navigation; nothing
changes inside the worker's 5 s typed-origin window; and a hidden frame
navigating ITSELF is out of model - it reaches the sink with zero input, proven
by a no-input control arm. Issue #593 stays open.

Residue is filed as issue #637 (child-frame `ns-allow` ->
`form.submit(target=_top)` -> `ns-allow-target-nav`), milestone
`v0.5.1-interaction-integrity`, labels `bug` / `track:interaction`.

Each of AI-31, AI-37, AI-38, AI-39, AI-40, and AI-41 is defined **only** inside
its own PR branch's `ACTION_ITEMS.md` and `docs/agentic/GATE3_GUIDES.md`. `main`
does not list them, so the human queue on `main` is incomplete; `ACTION_ITEMS.md`
now carries a pointer list under "Branch-held Gate-3 items".

Branch preservation: the unpushed #496 probe commits were pushed today as
`fix/issue496-doubleclick` @ `b75e5fc`. The uncommitted 2026-08-30 experiment for
a fail-closed cold-worker baseline was preserved (unverified, not applied) on
pushed branch `wip/issue566-baseline-fail-closed-20260830` @ `5df408c`. Local-only
superseded branches `docs/security-wave-handoff-20260902` @ `f5ac384` (its
NEXT_WORK refresh is folded into this change) and
`refactor/issue588-bundle-headroom` @ `cae79c5` (pre-rebase v1; v2 merged as
#590), plus remote `docs/issue557-post-merge-record` @ `cab309e`, are candidates
for owner-approved retirement under AI-23. The only fact worth keeping from the
last of those is that PR #557 merged as
`d132eace0d2b7e905d5d6eb5ad4c831236f925b2` closing #555/#559/#568; it is now in
the AI-29 resolved log line. About 60 Codex worktrees under
`C:\Users\Public\codex-shell-home\NavSentinel-*` were inspected; all are merged
and clean and none holds unpreserved work.

Four items on `main` are stale and were reworded today. AI-30 (#567 / PR #570),
AI-33 (#530 / PR #582), AI-35 (#539 / PR #586), and AI-36 (#558 / PR #589) read
as pre-merge gates "against the eventual PR", but those PRs merged on 2026-08-27:
#570 head `20fad0ac9d19bcbe3a1ca6b2d43ab14c7438ce53` merge
`ff063a677b6c633c1eca4955dbfe9b277e529f3a`; #582 head
`02b8e5c4504ff5127a9b6c4af7cf8cc30fd07da2` merge
`d1895b51763a6c6b7b5280f0ea80664d2f0c796d`; #586 head
`96be8e09cfe51168e4231625154ed366a408940b` merge
`b68f403a7f14379305cf1376f3ee4f188ef31493`; #589 head
`ee75bf408e04f528b0ee08006471f318fba3ef96` merge
`003905094982b9a772cc5f06fe504d372c99dd6b`. **No waiver record for those four
merges was found** in `docs/agentic/DECISIONS.md`, `HANDOFF.md`,
`ACTION_ITEMS.md`, or `docs/Project_Roadmap.md`; they are therefore recorded as
open post-merge Gate-3 checks on current `main`. No waiver or owner decision is
claimed or inferred. Their four guides in `docs/agentic/GATE3_GUIDES.md` now carry
matching post-merge banners that skip the open-PR prechecks and use the
`... on main at <SHA>` reply lines.

Environment, for the next session: Windows Defender quarantines
`tests/clickfix-detector.property.test.ts` in agent worktrees, so it can appear
as a spurious ` D` in `git status` - never stage that deletion. Leaked Codex MCP
containers had taken free RAM to ~600 MB and were swept with the estate hygiene
script before today's work.

## 2026-08-30 live delta

The development-architecture setup refreshed `main` at
`22377604a363141fc6e99a45800beca868307764`, assigned all 75 open issues, and
left zero unmilestoned. M0 has 10 open issues and M1 has 8; only those milestones
are active. Planned M2/M3/M4, gated M5, passive maintenance, and frozen R1 are
not fallback queues. The exact architecture and applied administration receipt
are under `docs/development-architecture/`.

Four PRs are open. #572 and #599 report `DIRTY` after `main` advanced; #600
reports `CLEAN`; #605 is a test-only M0 slice with Build / Unit red on #595's
tracked mutation-monitor scarce-reserve assertion. Leave every manual owner and
Chrome gate open. PR #572 is parked before AI-31 on a retained local rollback
survivor; its current head is not merge-ready. #600 is containment, while #601
retains the durable extension-origin authority boundary.

The agent-owned #186 slice changes no release code. It adds a loopback-only
bridge-peer fixture and real-extension browser lane. In ten fresh bundled-
Chromium profiles, the earliest normal authored-page peer sent one init but
received no challenge, no config acknowledgement, and no DOM harm receipt; the
real isolated bridge became ready every time. Benign and post-readiness mixed
controls also stayed usable and clear. This completes only
`NS-ADV-SELF-004-01-MODEL`. Do not force `02-ATTACK` with privileged pre-page
injection. Resume #186 only with a genuinely page-reachable same-session or
pre-page precondition, or take the separate #175 liveness/recovery model. The
exact-head rerun started the Proving Ground deny proxy before Chromium, recorded
zero fixture network violations, and retained 139 blocked browser-platform
attempts without forwarding them.

PR #602 landed the model lane. PR #603 repaired its evidence methodology and
merged as `ccff3d1c3f920ab8cbf1907ec31d6f1c93e9f018`; the superseded unfenced
network fields are `HARNESS_INVALID`. Final `main` CI run `33328852994` passed
Build / Unit and E2E, with release skipped as expected. The primary checkout was
clean and equal to `origin/main` at that merge commit. This docs-only closeout
changes no release code.

PR #605 records the bounded #449 evasion-family slice. It changes only Gym fixtures, proving-ground
tests, and programme records. All twelve evasion pages now use a shared target
contract that rejects non-loopback or unarmed local overrides. Exact code head
`b8a87caf67fad373d2b3e1d35180b64ff901a32b` passed the four-arm composite lane
and all 17 evasion regressions in bundled Chromium 143.0.7499.4. The valid local
receipt SHA-256 is
`6714563aa23497c69e1fa563fa27296fb82abe71945f94fa2e3abe573534c2df`:
attack baseline `HARM_REACHED`, protected and mixed `BLOCKED_PRE_HARM`, benign
`OBSERVED` with one persisted `nav_silent_allow` event and no UI intervention,
zero fixture-network violations, zero invalid sink attempts, and
56 browser-platform connection attempts denied before egress. Each arm uses a
sink-enforced one-use target identifier with a test-run TTL; earlier
checkout-dependent hash, unqualified profile, incorrect benign outcome,
descriptive-only use-count, or inaccurate arm-lifetime receipts are
`HARNESS_INVALID` and superseded. Nine legacy
core/RW destination holds remain. This does not change release behavior or
promote the family beyond `MODELLED`.

## Historical product baseline

At the 2026-08-10 product reconciliation, the product baseline was
**`5896756`**. The table below is retained as historical context; current Git
and the 2026-08-30 live delta above supersede it. That earlier code queue was
merged with merge commits (never squashed):

| PR | What landed |
| --- | --- |
| #519 | composed regression pinning the #302 pushState-flood vs `ns-nav-blocked` path |
| #524 | Playwright headed lanes are serial by default locally (#460); CI topology unchanged |
| #525 | WCAG AA contrast guard for the popup signal chips (#274) |
| #527 | claims honesty audit + verified-claims policy (#423) |
| #529 | removed unverifiable brand-alias / tracking-prefix trust entries (#320, #295) |
| #536 | recorded the AI-27 Gate-3 batch and the AI-28 boundary decision |
| #538 | **CI now runs on stacked PRs** (#537) |
| #543 | test-only blocked-click diagnostics for RW-18 (#460) |
| #544 | labels the blocked-click diagnostics by scenario and covers RW-14 (#460) |
| #528, #532, #535, #514, #534, #520, #521, #522, #526, #533, #542 | browser-surface queue merged after refreshed exact-head CI/review under its explicit Gate-3 waiver; no real-Chrome pass is claimed |
| #531 | OAuth callback corroboration merged under its separate #531-only waiver; #223 remains open for future measurement |

Re-derive live state (`git fetch`, `gh pr list`, `gh issue list`) before acting;
the values here age quickly.

## Closeout state

The eleven browser-surface slices tracked as **AI-27** are merged. Their explicit
Gate-3 waiver authorized the merge route; it is not a real-Chrome pass. **AI-28**
is resolved by #535's merged behavioural-data boundary: clear the event log,
prompt outcomes, adaptive scores, and domain profiles; preserve suite settings,
allowlist, and trusted domains.

Separate PR **#531** also merged under its #531-only Gate-3 / AI-14 waiver. It did
not claim a Chrome or `measure:fp` result, and #223 remains open. AI-14 remains
blocked for future measurement work. The human-owned queue is now AI-19, optional
AI-24, then AI-23; see `ACTION_ITEMS.md` for their exact scope.

## What this session found that was not on any list

- **#537 — stacked PRs ran no CI at all.** `ci.yml` filtered `pull_request` on
  `branches: [main]`, which matches the *base* branch, so dependent slices — the
  repo's own documented pattern — were never verified, while `mergeStateStatus`
  still reported `CLEAN`. It was hiding a genuinely broken build in #535. Fixed in
  #538; the rules now live in `docs/agentic/GIT_WORKFLOW.md`.
- **#523** — `ns-clipboard-write` is priority-but-not-floodable and unrate-limited
  at its emission site, so it can starve `ns-nav-blocked` the same way #302 did.
  The proposed two-class emission coalescing is awaiting an owner semantic choice;
  no implementation has been inferred.
- **#460** — test-only diagnostics landed in #543/#544 after serial 25-case
  re-measures each produced one native-popup failure in different fixtures. RW-14
  and RW-18 now label their failure payloads, but the direct-anchor Evasion 02
  path is architecturally distinct. #460 remains open pending an owner-authorized
  discriminating experiment; no runtime fix or further retry is justified yet.
- **#539** — `nav_reputation_late_warn` stamps the child frame's hostname while the
  popup matches the top-level domain, so #533's new gauge state cannot fire for
  third-party iframes, which is #219's headline case.
- **#530** — `.trust-pill` measures 4.22:1, below WCAG AA.
- **`instagramstatic.com`** was an *unregistered* brand-keyword `.com` sitting in
  `BRAND_KNOWN_ALIASES` — buyable by anyone, and it would have inherited exemption
  from `BRAND_KEYWORD_DOMAIN` and `SUBDOMAIN_STUFFING`. Removed in #529.
  `amazonws.com` was **kept**: RDAP and ARIN show it is Amazon's own 2004
  registration on Amazon corporate DNS, not the typosquat it resembles.

Two issues turned out to have insufficient prescribed fixes: #413's
registration-only change still emitted nothing past the alert cap (fixed with a
bounded scarce reserve), and #274's premise did not reproduce at all (the chips
already pass AA; pinned with a test instead of a restyle).

## Product posture

Owner direction on 2026-08-27 clarifies that v0.4.0 is pre-alpha, undistributed,
and has no established adoption, tag, GitHub release, CWS release, or
external-user evidence. The extension is local-first; interaction-only is the
release default (#509). Release integrity
still requires RI-01 extension-origin authority and #175/#186 bridge
identity/recovery. RI-02, RI-05, RI-06, and RI-07 are merged; their waived browser
checks are not evidence of a real-Chrome release pass.

Eight outcome milestones now exist. The open counts are M0 10, M1 8, M2 12,
M3 8, M4 14, M5 1, maintenance 4, and frozen R1 18. #439 was closed as absorbed
by active #449 plus #420; #449 is not frozen. Seven obsolete or absorbed issues
were closed in the administration pass. No milestone move waived an owner or
evidence gate.

## Verification caveats

- Successful CI is regression evidence, not open-web efficacy, compatibility,
  competitor superiority, or an external security audit.
- **No real-Chrome pass was performed for the eleven AI-27 PRs or #531.** The
  waivers are authority to merge, not browser or measurement evidence.
- Each merged head received refreshed base/head proof, focused local checks,
  independent review, and hosted Build/Unit plus E2E before merge.
- Current measured performance remains inside all budgets: total dist 92%; storage
  98%, Options 99%, credential guard 95%, service worker 93%, and popup 94%.

## Next sequence

Chris resolves AI-19, may run optional AI-24, and decides AI-23 worktree/branch
retirement; the branch-held Gate-3 items AI-31/37/38/39/40/41 are his too, and
#608 must not be checked before #600. The finish-or-park step is done: all six
open runtime PRs (#572, #599, #600, #608, #609, #636) are parked on owner gates,
so no agent-side work remains on them. Agent-side next is issue #637 or the next
bounded M0/M1 slice; do not open new runtime verticals that overlap the #600 /
#608 capture and loader seams. The four post-merge Gate-3 checks (AI-30, AI-33,
AI-35, AI-36) now apply to current `main` and have no waiver record. Refresh
Git/GitHub before selecting any new slice.
