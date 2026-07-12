# NavSentinel: Course Correction

> **Historical input:** the inner-loop/outer-loop diagnosis remains useful, but
> current product direction and actions live in
> [`Product_Strategy.md`](Product_Strategy.md) and
> [`Project_Roadmap.md`](Project_Roadmap.md). Its D26 runtime-refresh proposal
> is not active authorization; the beta boundary now has no runtime network.

*Written 2026-07-02 against `main @ 4ad9dd4`. Companion to
[Strategic_Outlook.md](Strategic_Outlook.md) (what is working and where the project is headed —
this document is deliberately the critical half). Derived from a five-lens adversarial analysis;
every claim below is sourced to a file, issue, or command independently verified on the date
above. Nothing here is speculation — where the evidence is a number, the number was re-checked.*

**How to read this:** §2 is the evidence. §3–§4 are the diagnosis (strategy, then execution).
§5 is the small set of principles that prevent recurrence. §6 is the sort-out plan with owners
and issue numbers. If you only have ten minutes, read §1, §2, and §6.

---

## 1. Summary: the inversion

NavSentinel's problem is not quality — it is **inversion**. The project runs its inner loop
(harden, review, merge) at maximum velocity and its outer loop (ship → users → feedback → learn)
at zero. In the three weeks to 2026-07-02, ~100 PRs merged — roughly 64 internal hardening, 27
docs/status syncs, 6 North-Star features (all on or before June 19), and 3 user-visible fixes — while
the product accumulated: zero releases, zero users, a release blocker idle for 12 days, all 11
North-Star issues untouched since their creation day, and efficacy numbers that are stale,
statistically underpowered, and were measured with the primary detection layer disabled.

Every individual behavior in that sentence is locally rational and executed with discipline. The
composition is a system that polishes an artifact nobody can install, to a standard nobody has
validated, on a schedule that starves the only work that would change either fact.

The fix is not to work harder or review less rigorously. It is to re-point the machine — **point
everything at shipping, measure before publishing claims, improve only what measurement
justifies** — and to change the handful of process rules that currently make the inversion the
path of least resistance.

---

## 2. The hard truths

Each row was independently verified 2026-07-02.

| # | Truth | Evidence |
|---|---|---|
| 1 | **Never shipped, zero users.** No CWS submission, no GitHub release, no git tag, 0 stars/0 forks/0 watchers on a public repo since 2026-01-18; every one of the ~126 pre-review issues and 288 PRs is self-authored (as are the #415-#427 this review seeded). Roadmap P3-06's done-when was "listed and installable from CWS"; it was checked as "prep done." | `gh release list` (empty); `git tag` (empty); `gh api repos/Chris0Jeky/NavSentinel`; Project_Roadmap.md lines ~896/990 |
| 2 | **The shipped reputation layer is fake.** `reputation_data.bin` is 52 bytes — a 15-domain `.example` test filter. The +50 known-bad NRS factor cannot fire on any real domain; `release.mjs`/`package.mjs` have no bloom-build step; CI runs only `build:bloom:test`. README line 9 and docs/cws-listing/STORE_LISTING.md line 39 claim threat-feed protection anyway. | Issue #321 (open since 2026-06-20); `ls -la extension/public/reputation_data.bin` |
| 3 | **Every efficacy number is stale and was measured against code that no longer exists.** FP 0.72% and corpus TP 28% both date to 2026-05-01 on v0.2.1. Since then: 85 commits touching `capture_isolated.ts`, 46 across the four scoring modules (scoring/nrs/adaptive_scoring/nav_anomaly), 27 to `credential_guard.ts`, including the #354 threshold relief shipped *specifically* to fix the FP number — never re-measured. | `tests/fp-results/tranco-measurement-2026-05-01.md`; `tests/corpus/results/validation-2026-05-01.md`; `git log --since=2026-05-01` |
| 4 | **The numbers weren't valid even when fresh.** The FP run covered ~138 successful visits (top-200 attempted) — statistically incapable of bounding the <0.1% top-1000 target (needs ~3000). The corpus ran static snapshots from 127.0.0.1 with `isTrusted=false` synthetic clicks: domain signals neutered, JS-injected password forms invisible (~16 of ~21 missed), and the nav_rollback "detections" likely post-render auto-redirect artifacts. An earlier run scored 0/47 — the number swings 0%→28% on harness mechanics. And the 60% TP target is defined "after bloom filter" — measured with the bloom layer disabled (truth 2). | The two results files' own limitations sections; Project_Roadmap.md lines ~1127-1137; `tests/corpus/validation-results.json` (2026-04-25) |
| 5 | **The competitive claim has no competitive data.** P2-10 is marked done, but `benchmark-baseline.json` says `lastRun: null`, `tests/benchmark-results/` holds only `.gitkeep`, and `benchmark.mjs` contains no Safe Browsing arm at all — while "the only extension that detects DoubleClickjacking/ClickFix/OAuth-abuse" is the designated store headline. | scripts/benchmark-baseline.json; Project_Roadmap.md lines ~466, 892-894 |
| 6 | **Visual-sim is detection theater.** Brand templates are seeded-PRNG placeholders; the e2e suite asserts they can never match; the NRS hook (cap +30) is dead code — yet the capture path ships inside one of the two tightest chunks (95% of budget) and the roadmap lists P4-01 "in progress." | scripts/build-brand-templates.mjs; tests/e2e/visual-sim.spec.ts:23-31; nrs.ts ~275 |
| 7 | **The human gate is starved and the machine routes around it — downward.** All 3 open PRs are human-gated (#273: 13 days for a ~10-minute check). The strategic queue (11 North-Star issues) has had zero activity since 2026-06-13. Meanwhile the loop, forbidden to stop ("Never stop on out of tasks — run a Discovery pass", ORCHESTRATOR.md line 22), declared the ungated backlog EXHAUSTED three times and kept going: the July 2 drain of 4 LOW/MED issues seeded 3 new ones. 35% of the open backlog is now self-regenerating hardening residue; 0 of 49 open issues concerned users or distribution before this review. | gh pr/issue timestamps; ACTION_ITEMS.md lines 11/24/28; ORCHESTRATOR.md cycles 39-42 |
| 8 | **Real-browser verification has silently stopped.** Gate-3 was waived 2026-06-05 with checks "deferred, not dropped" to a watchlist — which has 16 unchecked items, covers only PRs through #249 (ACTION_ITEMS claims it also covers #263/#265, but those items were never added to the file), and has never had a recorded run. ~27 runtime-behavior PRs (MAIN-world patches, MutationObserver lifecycle, submit-path changes — the exact class that produced the claude.ai grey-screen #347) merged since the last real-Chrome check on 2026-06-23, auto-classified "non-browser" because they had unit tests. The PRs actually held as "browser-surface" are a popup chip color (#273) and one MAIN-world de-harden (#356) — the ~27 comparable runtime changes sailed through. | docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md (last commit 2026-06-13); merged-PR list since 2026-06-23 |
| 9 | **Status bookkeeping consumes ~27% of throughput and the docs still conflict.** 27 of the last 100 merged PRs are standalone docs-syncs (two on 2026-07-02 alone). ACTION_ITEMS.md is 82KB/~35k tokens with 28 "superseded" snapshots — and CLAUDE.md forces every session to read it first. HANDOFF.md is 5 sessions stale; the roadmap header contradicts its own live-pointer; CLAUDE.md's test counts are off by 2.4x (38 vs 92 files). ACTION_ITEMS itself instructs readers not to trust the other status docs. | wc/grep on ACTION_ITEMS.md; merged-PR titles; CLAUDE.md vs `ls tests/` |

---

## 3. What's wrong — strategy

### 3.1 Shipping was redefined away instead of done

Phase 3 "Productize" was declared complete while its central deliverable — a product a stranger
can install — never happened. P3-06's done-when quietly narrowed from "listed and installable"
to "listing prep done"; P3-07 scripted a release process that has never produced a release;
P3-09's security audit became a scope document with no outreach. The phase-gate system (D14:
"Don't start Phase N+1 until Phase N gates are met") was structurally sound and then not
enforced at exactly the gate that mattered most. **Consequence:** Phases 4 and 5 built
differentiation and self-tuning machinery on top of a product with no users to differentiate for
or tune against.

### 3.2 The validation loop is self-referential

Every test, fixture, review, and audit in the repo was authored by the same entity being tested.
That produces excellent *regression* discipline (nothing that once worked silently breaks) and
zero *validation* (no evidence the product helps anyone). The thesis review said this plainly in
April ("no validation against real attacks... thresholds tuned by feel"); the corpus and FP runs
in May were the right response, executed once, never repeated, and their known-invalid results
were left standing as the efficacy story. A security product whose efficacy is unfalsifiable is
indistinguishable from theater — and the way out (users + recurring measurement) has been
available and unexercised for two months.

### 3.3 Claims drifted above evidence

README and the draft store listing claim threat-feed protection the shipped artifact does not
contain (truth 2). The designated store headline is a competitive claim with no competitive
benchmark (truth 5). Roadmap gates are checked whose done-whens are literally false (truths 1,
5; the P1-05 re-run). Each drift was individually small and rationalized; compounded, the
repo's strategic narrative now materially overstates the product — dangerous for a project whose
brand *is* honesty and explainability, and publicly falsifiable the day a reviewer opens the
`.bin` file. (Fix: #423, #418.)

### 3.4 The North-Star program has no user-facing counterpart

To be fair to the design: the per-install, privacy-local flywheel ("single user, privacy-
unconstrained *locally*") is a deliberate D16 choice and works identically at n=1 and n=1000 —
that is not the problem. The problem is what's *missing around it*: no program addresses
distribution or acquiring even a second user, and under local-first no external user's data ever
reaches the maintainer anyway — so the sophisticated tuning machinery (conformal calibration,
active learning "calibrated to a single human's tiny labeling budget") will only ever be
validated against its author's browsing until someone ships and dogfoods it. The programs are
good; their sequencing assumes feedback that only shipping can create.
(Fix: re-sequencing in [Strategic_Outlook.md](Strategic_Outlook.md) §4; #425.)

---

## 4. What's wrong — execution

### 4.1 The loop's objective function is wrong, and it self-feeds

"Never stop — run a Discovery pass" made sense when the backlog held HIGHs. Now the marginal
finding is `slice(-0)` at cap=0, and each drain seeds more LOWs than it closes (truth 7). The
loop is a superb fix machine pointed at an exhausted seam, while the highest-value *ungated*
work — corpus failure triage (#426), corpus methodology (#417), the silence gate (#232) — sat
unpicked because it is analysis-shaped rather than fix-shaped. (Fix: #422 priority ladder +
icebox; #427 hygiene.)

### 4.2 Human bandwidth is the binding constraint and the process spends it badly

The system's real throughput limit is Chris's attention, in bursts. The process spends that
scarce resource on: re-reading a 35k-token ACTION_ITEMS file each session, per-PR gate decisions
issued one at a time with separate checkout/build/load costs, and Q&A cycles — while batching
(one 90-minute session clears #273 + #356 + #399 + #321) would un-gate more value than three
weeks of agent output. Latency evidence: 13 days for a 10-minute check is an activation-energy
problem, not a time problem. (Fix: #419 batch runner + WIP cap; AI-15.)

### 4.3 Gate-3 became ritual, not protection

The "browser-surface" classification keys inconsistently on surface visibility rather than
runtime blast radius, so MAIN-world global patches auto-merge (#402, #405/#412) while a chip
color waits 13 days (truth 8). The deferred watchlist that made the 2026-06-05 waiver safe was never run and
no longer reflects what merged. Either the risk tiering is fixed and a headed lane automates the
class (#420), or Gate-3 should be acknowledged as decorative. (Fix: #419 re-tiering, #420 lane.)

### 4.4 The bookkeeping tax is ~27% and rising

Truth 9. The append-only snapshot pattern means every session pays more to start than the last.
One live snapshot + one append-only log + docs-sync folded into the code PR that changed the
truth reclaims roughly a quarter of loop throughput and ~30k tokens of mandatory reading per
session, with zero information loss (history goes to archive, not deletion). (Fix: #421.)

### 4.5 Structural work is systematically skipped

The slice-optimized loop routes around anything design-shaped: the #374 chunk split
(owner-authorized, fully specified, unstarted while 6 of 12 budgets sit ≥89%), the bridge
heartbeat/identity pair (#175/#186, parked ~4-5 weeks on the self-declared highest-risk seam, last
bridge security review 2026-05-16), and the capture decision core (2,055-line export-less entry
script, zero direct unit tests, 25% of the codebase in three such monoliths). These don't fit
the "small reviewable slice" format, so they age indefinitely. (Fix: schedule them as explicit
structural cycles — see §6 Phase C.)

### 4.6 The orientation layer is decaying

CLAUDE.md's test-surface counts are off 2.4x; AGENT_INDEX still names a PR merged two weeks
ago as the active gate; the architecture doc predates the entire June sprint. This is bus-factor
insurance lapsing — the exact docs a returning maintainer (or a fresh agent after a context
wipe) needs first. (Fix: folded into #421.)

---

## 5. Corrective principles

1. **Ship before polish.** No hardening PR outranks a release-path task while the product is
   unreleased. The release umbrella (#415) is the standing top priority until closed.
2. **Measure before tune — actually.** D25 already says this; enforce it: no scoring/threshold
   change merges without a current measurement artifact (silence gate #232 makes this automatic;
   until then, the measurement-reset session #416 sets the baseline).
3. **No claim without a measurement.** README/store/roadmap checkboxes state only what a
   committed artifact proves (#423). Gates get unchecked when their done-when is false.
4. **Human attention is the scarcest resource — batch it, cap it, protect it.** One batch
   session protocol (#419/AI-15), a WIP cap on human-gated PRs, session-end escalations instead
   of new discovery passes (#422), and a startup read that costs 2k tokens, not 35k (#421).
5. **Risk-tier by runtime blast radius, not file type.** MAIN-world and submit-path changes are
   browser-surface regardless of unit coverage (#419). Dependency to state plainly: the stricter
   tier only works alongside either a committed recurring batch-session cadence (e.g. one
   30-minute sitting weekly) or the headed lane (#420) being operational — otherwise it throttles
   the North-Star spine through the very gate this document calls starved. And substituting the
   headed lane for manual Gate-3 revises the standing Q5 decision (Gate-3 = manual Chrome): that
   is Chris's call to make explicitly, not an agent policy edit.
6. **Discovery is milestone-gated.** The fix machine points at the release path and the
   North-Star spine; discovery passes resume after the next release milestone, and LOW residue
   goes to the icebox by default (#422).

---

## 6. The sort-out plan

### Phase A — this week (mostly one human sitting)

| Action | Owner | Ref |
|---|---|---|
| Read this doc + Strategic_Outlook; confirm or amend the direction | Chris | — |
| Run the batch session: #321 bloom build → Gate-3 on #273/#356 → `measure:fp` for #399 → **a real-Chrome regression sweep over the merged-unverified backlog** (refreshed watchlist golden paths + #347-class console checks, same sitting) | Chris (~2h; agent prepares the runner/checklist + refreshed watchlist first) | #419, AI-15 |
| Start official dogfooding (NavSentinel in Chris's daily browser) — **before** any CWS submission; local-first means field breakage is invisible except via reports | Chris (5 min install) | #425 step 1 |
| CI/release assert: shipped `.bin` must have m above a real-filter floor | Agent | #321 companion (#322 scope) |
| Adopt the stop-rule + icebox; no new discovery passes | Agent — **only after Chris confirms the direction (row 1)**; this reverses a maintainer-mandated rule, so the CLAUDE.md/ORCHESTRATOR edits wait for that confirmation | #422 |
| Backlog hygiene sweep (close #322, reconcile #350, drain #339/#395) | Agent | #427 |

### Phase B — weeks 1-3 (make the numbers real)

| Action | Owner | Ref |
|---|---|---|
| Measurement reset, FP half: top-1000 FP run + benchmark baseline; decide #399 on data | Chris session | #416 |
| Corpus methodology v2 (real hostnames, trusted clicks, protected-vs-fired) — **before** any corpus re-run: re-running the current harness reproduces the exact invalidity Truth 4 documents | Agent | #417 |
| Corpus TP re-measure (**after #417**) + triage all 72 missed pages (first split: harness-artifact vs real gap); seed gap fixes | Agent + short Chris run | #416, #426 |
| Claims honesty pass (README, STORE_LISTING, roadmap gates, stale counts) | Agent | #423 |
| Status-doc collapse + orientation refresh | Agent (after row-1 confirmation, as with #422) | #421 |
| Benchmark truth-up: SB comparison arm or re-scoped headline | Agent | #418 |

### Phase C — weeks 3-6 (ship and re-point the machine)

| Action | Owner | Ref |
|---|---|---|
| v0.5.0: tag, package, **unlisted** CWS submission (dogfood already running; expect extended review for `<all_urls>`+MAIN-world — submit early, reuse PRIVACY_DISCLOSURE for permission justifications, treat respond-and-resubmit as normal) | Chris + agent | #415 |
| Unlisted beta to 5-10 people | Chris | #425 |
| Silence CI gate | Agent | #232 |
| Bloom refresh + DNR hard-block (reputation becomes prevention). Hosting/signing/cadence of the D26 endpoint = Chris decision; agent implements. **Permission caveat:** new manifest permissions post-submission trigger re-review and can disable the extension for beta users — declare them in the v0.5.0 manifest (wire later) or schedule an explicit v0.6.0 | Chris decides; agent implements | #243, #242 |
| Headed verification lane scheduled on the maintainer machine (if adopted as a Gate-3 substitute, that's an explicit Q5 revision by Chris) | Agent + Chris approval | #420 |
| Structural cycle 1: #374 chunk split, then visual-sim decision | Agent / decision | #374, #424 |

### Phase D — standing (the new normal)

- North-Star spine in Strategic_Outlook §4 order; ML/companion parked until the size decision
  and a user base exist (#424, #244, #245).
- Structural cycle 2: bridge pair #175 + #186 with a fresh bridge security review — **a
  prerequisite gate for the public listing/launch post, not a parallel item.** A security product
  should not invite Show-HN-grade adversarial attention while its self-declared highest-risk seam
  carries a known-stale review. (Unlisted beta at n=5-10 may proceed before it.)
- Public launch + audit outreach once the beta is quiet **and the bridge cycle is done** (#425).
- The 90-day checklist in [Strategic_Outlook.md](Strategic_Outlook.md) §5 is the scoreboard.

### What we keep (do not overcorrect)

The review gates, the bot-comment discipline, the regression-test-proven-to-fail-pre-fix rule,
the perf-budget system, the failure ledger, and the zero-tech-debt seeding all stay — they
demonstrably catch real bugs. This correction changes *what the machine points at* and *how the
human's hours are spent*, not the machine's quality bar.

**And this review's own footprint:** it added 13 issues, a label, two standing docs, a new AI
item, and one more ACTION_ITEMS snapshot — in a document that condemns bookkeeping bloat. The
mitigations: both docs are point-in-time snapshots to be archived after the 90-day check (their
surviving content folds into Project_Roadmap.md); the #415-#427 cohort is `strategy`-labeled so
the #427 sweep treats it as a unit; and the ACTION_ITEMS trim (#421) removes more than this
review added.

---

## 7. Task index

**Seeded by this review (label `strategy`):** #415 release umbrella · #416 measurement reset ·
#417 corpus v2 · #418 benchmark truth-up · #419 Gate-3 batching/re-tier/WIP cap · #420 headed
lane · #421 status-doc collapse · #422 stop-rule + icebox · #423 claims honesty · #424
visual-sim decision · #425 distribution/first users · #426 corpus TP triage · #427 backlog
hygiene.

**Key existing:** #321 (AI-9, release blocker) · #273/#356/#399 (Gate-3 / measure:fp queue) ·
#232/#237/#239-#246/#252 (North-Star spine) · #374 (chunk split) · #175/#186 (bridge pair) ·
AI-15 (batch session — ACTION_ITEMS.md).
