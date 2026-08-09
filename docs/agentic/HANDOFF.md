# NavSentinel handoff

Updated 2026-08-08. This is an optional short snapshot; live Git/GitHub state,
product tests, `docs/Project_Roadmap.md`, and `ACTION_ITEMS.md` are authoritative.
Historical cycle detail remains in `ORCHESTRATOR.md` and is not required reading.

## Where `main` is

`main` is at **`5377495`** with exact-main product CI green. Seven PRs merged on
2026-08-08, each with a merge commit (never squashed):

| PR | What landed |
| --- | --- |
| #519 | composed regression pinning the #302 pushState-flood vs `ns-nav-blocked` path |
| #524 | Playwright headed lanes are serial by default locally (#460); CI topology unchanged |
| #525 | WCAG AA contrast guard for the popup signal chips (#274) |
| #527 | claims honesty audit + verified-claims policy (#423) |
| #529 | removed unverifiable brand-alias / tracking-prefix trust entries (#320, #295) |
| #536 | recorded the AI-27 Gate-3 batch and the AI-28 boundary decision |
| #538 | **CI now runs on stacked PRs** (#537) |

Re-derive live state (`git fetch`, `gh pr list`, `gh issue list`) before acting;
the values here age quickly.

## The human queue is the bottleneck

**Ten browser-surface PRs are open, reviewed, and verified green, and none can
merge without Chris.** They are tracked as a single item, **AI-27**, in
`ACTION_ITEMS.md`, listed in merge order with per-PR notes on what is worth a
human's eyes. **AI-28** records the one scope decision the session had to assume
rather than ask (the behavioural-data boundary for #474).

Slots 1-3 are a three-deep stack — **#528 ← #532 ← #535** — and must merge
oldest-first. Read AI-27's stack rule before touching them: the safe-sounding
"never delete a base branch" is wrong, and following it strands the children on a
merged base so the slice never reaches `main`.

PR **#531** is open but titled `[HELD on AI-14/#417]` and is **not** part of the
batch. It exists as a durable backup of work that previously lived only on one
machine; the owner queue explicitly blocks #223 until #417 supplies methodology.

## What this session found that was not on any list

- **#537 — stacked PRs ran no CI at all.** `ci.yml` filtered `pull_request` on
  `branches: [main]`, which matches the *base* branch, so dependent slices — the
  repo's own documented pattern — were never verified, while `mergeStateStatus`
  still reported `CLEAN`. It was hiding a genuinely broken build in #535. Fixed in
  #538; the rules now live in `docs/agentic/GIT_WORKFLOW.md`.
- **#523** — `ns-clipboard-write` is priority-but-not-floodable and unrate-limited
  at its emission site, so it can starve `ns-nav-blocked` the same way #302 did.
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

Unchanged by this session. v0.4.0 remains an undistributed pre-release alpha with
no tag, GitHub release, CWS release, or external-user evidence. The extension is
local-first; interaction-only is the release default (#509). Release integrity
still requires RI-01 extension-origin authority and #175/#186 bridge
identity/recovery; RI-02, RI-05, RI-06 and RI-07 are implemented but unmerged,
sitting in the AI-27 queue.

Two milestones now exist: `v0.5.0-unlisted-beta` (7 real blockers) and
`post-beta-horizon` (the 15 frozen Horizon epics #439–#453, moved out of the
active queue).

## Verification caveats

- Successful CI is regression evidence, not open-web efficacy, compatibility,
  competitor superiority, or an external security audit.
- **No real-Chrome pass was performed for any of the ten queued PRs.** That is
  exactly what AI-27 asks for.
- #532 and #535 were verified by `workflow_dispatch`, which builds the branch
  **tip** rather than the base-plus-head merge commit a `pull_request` run builds.
  If either base moves before merge, that evidence goes stale — merge the new base
  in and re-dispatch. AI-27 records this.
- `total dist` sits at **99% of its 500KB budget** and CI gates on it. The
  RI-05 + RI-07 stack *reclaims* space (`main_guard` 18.5KB → 14.2KB), so merging
  slots 1-2 early is what buys headroom for the rest. The popup chunk is at 96%
  with ~400 bytes spare after #533.

## Next sequence

Chris runs AI-27 (one Gate-3 batch session) and answers AI-28. Agent-side, the
unblocked work after that is RI-01 extension-origin authority and #175/#186; both
are large and neither was touched here.
