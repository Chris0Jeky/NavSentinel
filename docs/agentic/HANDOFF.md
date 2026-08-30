# NavSentinel handoff

Updated 2026-08-10. This is an optional short snapshot; live Git/GitHub state,
product tests, `docs/Project_Roadmap.md`, and `ACTION_ITEMS.md` are authoritative.
Historical cycle detail remains in `ORCHESTRATOR.md` and is not required reading.

## 2026-08-30 live delta

The open browser-surface queue is PR #572, PR #599, and PR #600. Leave their
manual owner and Chrome gates open. PR #572 is parked before AI-31 on a retained
local rollback survivor; its current head is not merge-ready.

The agent-owned #186 slice changes no release code. It adds a loopback-only
bridge-peer fixture and real-extension browser lane. In ten fresh bundled-
Chromium profiles, the earliest normal authored-page peer sent one init but
received no challenge, no config acknowledgement, and no DOM harm receipt; the
real isolated bridge became ready every time. Benign and post-readiness mixed
controls also stayed usable and clear. This completes only
`NS-ADV-SELF-004-01-MODEL`. Do not force `02-ATTACK` with privileged pre-page
injection. Resume #186 only with a genuinely page-reachable same-session or
pre-page precondition, or take the separate #175 liveness/recovery model.

## Latest product baseline

At the latest live product reconciliation before this documentation update, the
product baseline was **`5896756`**. The code queue was merged with merge commits
(never squashed):

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

Two milestones now exist: `v0.5.0-unlisted-beta` (7 real blockers) and
`post-beta-horizon` (the 15 frozen Horizon epics #439–#453, moved out of the
active queue).

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
retirement. Agent-side, #523 needs the clipboard-telemetry semantic choice, #460
needs an owner-authorized discriminating experiment, and AI-14 remains blocked on
#417 methodology. Refresh Git/GitHub before selecting any new slice.
