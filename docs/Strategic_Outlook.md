# NavSentinel: Strategic Outlook

> **Historical input:** superseded for current product direction by
> [`Product_Strategy.md`](Product_Strategy.md). Keep this dated analysis for
> provenance; do not use its roadmap, D26 runtime-refresh proposal, or
> competitive claims as live truth.

*Written 2026-07-02 against `main @ 4ad9dd4`. Companion to [Course_Correction.md](Course_Correction.md)
(what is broken and how to sort it out — read that one too; this document is deliberately the
optimistic half). Derived from a five-lens adversarial analysis (product strategy, detection
efficacy, engineering health, execution process, backlog economics); every factual claim below is
sourced to a file, issue, or command that was independently verified on the date above.*

**Audience:** Chris (the maintainer) and any agent picking the next slice of work. This document
answers three questions: what is genuinely working, where is the project headed, and what is the
effective path to get there.

---

## 1. Verdict

NavSentinel is a **well-engineered product aimed at the right target, held back almost entirely by
things that are not engineering**. The thesis is sound and has gotten *more* relevant since it was
written. The differentiating detections exist and are continuously regression-tested. The
engineering system — tests, budgets, adversarial review, failure capture — is unusually disciplined
for a solo project and demonstrably catches real, exploitable bugs before merge. The North-Star
plan is coherent, evidence-derived, and points somewhere worth going.

What stands between this project and mattering is short and concrete: it has never shipped, its
efficacy numbers are stale and were measured with its strongest layer disabled, and its execution
system is optimized for a loop (merge hardening PRs) that no longer moves the product. Those are
sequencing and process problems — fixable in weeks, not months. The corrective program is in
[Course_Correction.md](Course_Correction.md); this document describes the destination and the path.

---

## 2. What NavSentinel does well

### 2.1 The thesis targets the fastest-growing attack classes, and the detections are real

The core bet — **local-first, interaction-level deception detection** — sits exactly where the
threat landscape moved: ClickFix accounted for ~47% of initial access in 2025 (Microsoft),
DoubleClickjacking (Jan 2025) bypasses X-Frame-Options, CSP frame-ancestors, and SameSite cookies,
and adversary-in-the-middle phishing — the class that carries OAuth consent abuse — rose ~146% in
2024 ([Product_Thesis_Review.md](Product_Thesis_Review.md) §3.0.3).
These are attacks that URL reputation structurally cannot see, because they happen *after* the URL
was approved, inside the interaction.

Critically, the differentiators are implemented, not aspirational: DoubleClickjacking detection
(P2-01, PR #36), ClickFix/fake-CAPTCHA detection (P2-02, PR #37), OAuth flow monitoring (P2-05,
PR #47), redirect-chain correlation, DOM mutation monitoring, and pushState gating all shipped with
gym fixtures and E2E coverage. The 123 gym fixtures and the CI e2e lane (real built extension in
real Chromium) mean the fixture-level detection story is *continuously verified* — the one efficacy
claim in the repo that is current every day.

### 2.2 The engineering system is a genuine asset

- **Performance budgets as governance**: 12 budgets enforced in CI on every PR and at release,
  with `scripts/check-perf-budget.mjs` doubling as an audit trail — every cap bump carries its
  issue number and rationale. This is rare discipline at any team size.
- **Test depth**: 92 unit-test files (~39.8K LOC) against ~19.4K LOC of extension source — a 2:1
  test-to-source ratio — plus 14 e2e specs, property tests, stress and corpus lanes. Unit tests
  grew 2,206 → 2,845 in five weeks without a single skipped-test debt entry.
- **Testability-by-extraction works**: `main_guard_helpers.ts`, `bridge_outbound.ts`,
  `silent_decision.ts`, `sw-handlers` show the established pattern for making entry-script logic
  unit-testable. (It now needs applying to the capture decision core — see the path below.)
- **The verification machine catches real bugs**: the two-round adversarial review gate found HIGH
  exploitable issues on the very last session's PRs (#405 self-replace shadow-observer evasion,
  #407 unbounded-trim DoS on the credential-submit path), and the "always address bot comments"
  discipline caught async/race edges internal review missed on #360/#369/#370/#377. This is not
  process theater; it demonstrably works.
- **Zero-tech-debt seeding is real**: every review finding is either fixed or becomes a concrete
  issue with a fix path; the failure ledger converts one-off failures into standing lessons (the
  `softPatchProto` pattern that fixed the claude.ai grey-screen came directly from a ledger entry).

### 2.3 The measurement infrastructure exists

This is worth stating because Course_Correction is hard on the measurement *numbers*: the
*machinery* is built and good. `scripts/measure-fp.mjs` (920 lines: interaction-phase separation,
resume, per-site attribution), `scripts/fetch-phishing-corpus.mjs` (OpenPhish + PhishTank),
`scripts/benchmark.mjs` with per-category thresholds, and a corpus e2e lane all exist. The gap is
*running* them, not building them — which makes the fix cheap (#416).

### 2.4 The planning layer is research-grounded and honest

The [North-Star roadmap](NORTHSTAR_ROADMAP.md) is derived from a 153-finding adversarially-verified
internal audit plus externally-verified research, with a decision log (D21–D26) that made real
choices: pivot visual-sim to logo embeddings (D24), one signed network exception for bloom refresh
(D26), instrument-before-tuning (D25). The [Product Thesis Review](Product_Thesis_Review.md) openly
estimates ~25-35% coverage of common browser threats and calls the project a prototype — the
self-assessment culture is honest, which is precisely what makes course correction possible.

### 2.5 The repo is legible to agents and humans

The seam maps (`autodoc/AGENT_INDEX.md`), skills, protocols, and ACTION_ITEMS contract let a fresh
agent (or a returning human) produce reviewable work quickly — ~100 PRs merged in three weeks with
consistent gates is evidence the system scales throughput. The same infrastructure is bus-factor
insurance for a solo maintainer, *provided the orientation docs stay current* (see #421).

---

## 3. Where it's headed: the destination

The destination is well-defined and worth reaching. Composing the roadmap, the North-Star programs,
and the decision log, **NavSentinel v1** is:

> A shipped, measurably-quiet browser extension that catches interaction-level attacks nothing else
> catches — DoubleClickjacking, ClickFix, OAuth consent abuse — with near-zero false positives on
> normal browsing, every decision explainable in plain language on demand, improving from its own
> usage data, all without sending a byte anywhere (one signed bloom-list fetch excepted, D26).

The four North-Star programs map cleanly onto that sentence:

| Program | Delivers | Keystone slices |
|---|---|---|
| A — Zero-FP Smart Mode | "measurably quiet" | P5-A1 silence CI gate (#232); A2–A5 largely shipped |
| B — Friend-Advisor | "explainable on demand" | P5-B1 shipped (#253); journal UI #237; explanations everywhere (P5-B2) |
| C — Feedback flywheel | "improving from its own usage" | P5-C1 shipped (#249); full-distribution capture #239; storage #240; replay harness #241 |
| D — Platform leverage | "catches what others can't" durably | DNR hard-block #242; bloom refresh #243; Firefox port (P4-03); native companion #244 |

**Assessment: the direction is right; the sequencing is not.** The programs were built for a user
base of one and scheduled behind an infinite hardening loop (see Course_Correction §3.4, §4.1).
Re-sequenced by ship-value — release first, measurement second, then the program slices that serve
day-one users — the same destination becomes reachable and, crucially, *falsifiable*: real users
will tell us whether zero-FP and friend-advisor actually land.

The window argument still holds but is narrowing: no consumer extension detects DoubleClickjacking
or ClickFix today, but Chrome now ships local Gemini Nano scam detection (noted in our own D21),
and the positioning safe harbor remains the thesis review's own line — **"catches what Safe
Browsing can't see"** — which is defensible without competitive benchmarks (though #418 should
still produce them).

---

## 4. How to get there effectively: the path

The organizing principle: **point everything at shipping; measure before you publish claims;
improve only what measurement justifies.** Concretely, the gates are: the *unlisted* beta ships as
soon as claims are honest (#423) and a real-browser regression sweep has run; the *public* listing
waits for fresh post-#321 measurement artifacts and the bridge review. That ordering keeps speed
without repeating the claims-drift failure diagnosed in Course_Correction §3.3.

### Step 1 — Ship the unlisted beta (this month) → #415, #419

Cut v0.5.0 and submit it to the Chrome Web Store, **unlisted first**. Everything required is
enumerated and small: the real bloom filter (#321 / AI-9), the Gate-3 queue (#273/#356/#399), the
claims alignment (#423), the store-asset checklist (docs/cws-listing/REVIEW_CHECKLIST.md), a tag —
plus two additions the verification round forced: **a real-Chrome regression sweep** over the
merged-unverified backlog (refreshed watchlist golden paths + the #347-class console checks, run
inside the same batch sitting), and **dogfooding starts before submission**, not after — local-first
means field breakage is invisible except via manual reports, so Chris's own browser is the only
early-warning system. Expect extended CWS review (`<all_urls>` + MAIN-world injection is exactly
the profile that draws it); submit early, reuse PRIVACY_DISCLOSURE.md for per-permission
justifications, and treat respond-and-resubmit as a normal loop. The release umbrella is **#415**;
the human batch protocol is **AI-15** in ACTION_ITEMS.md.

### Step 2 — Measure (same month) → #416, #417, #426, #418

Split by dependency. **Immediately after #321**: the FP half of the measurement reset (#416) —
Tranco top-1000 run + benchmark baseline. **The corpus TP half waits for #417** (methodology v2) —
re-running the current harness would reproduce the exact invalidity Course_Correction Truth 4
documents (numbers that swing 0%→28% on harness mechanics). Meanwhile agents build #417 and run
the 72-page failure triage (#426, first split: harness-artifact vs real gap) — the highest-value
*ungated* engineering work in the repo. #418 either produces the Safe-Browsing comparison or
re-scopes the headline claim.

### Step 3 — The North-Star spine, re-sequenced by ship-value (weeks 3-8)

Pull forward what serves day-one users; park what needs a corpus that doesn't exist yet:

1. **#232 (P5-A1)** Smart-Mode-Silence CI gate — converts FP work from human-gated ritual to
   automated verdicts; explicitly the prerequisite D25 demands.
2. **#243 (P5-D2)** bloom runtime refresh — the audit's confirmed-critical staleness fix; pairs
   naturally with the now-real filter from #321. *Split ownership:* the hosting/signing/cadence of
   the D26 endpoint is a Chris decision; agents implement.
3. **#242 (P5-D1)** DNR hard-block — turns the real reputation data into *prevention*, the only
   MV3-native block. *Permission caveat for both #242/#243:* new manifest permissions after the
   initial CWS submission trigger re-review and can disable the extension for beta users until
   re-approved — either declare the `declarativeNetRequest` + refresh-endpoint permissions in the
   v0.5.0 manifest (declare now, wire later) or schedule these as an explicit v0.6.0 with that
   cost named.
4. **P5-B2** explanations everywhere + the popup truth cluster (#205/#219/#215) — makes the
   product explicable to strangers, which matters the day strangers install it.
5. **#237 (P5-B3)** Decision Journal side panel — the friend-advisor centerpiece.
6. **#374 chunk split, then #239/#240 (P5-C2/C4)** full-distribution capture + flywheel storage —
   the data foundation. #239 grows `capture_isolated`, which sits at 95% of budget: per the repo's
   own standing rule, the chunk-shrinking #374 goes first.
7. **#241 (P5-C5)** replay/tuning harness — now it has data to replay.
8. **Park for now**: #245 (on-device ML spike) and #244 (native companion) until the size-budget
   decision is made (#424 forces it) and there are users whose corpus justifies them.

*Gating note:* several spine slices (#242/#243 runtime behavior, P5-B2/popup UI) are
browser-surface under the re-tiered #419 classification, so this schedule only works if the
Gate-3 batch session becomes a committed recurring cadence (e.g. one 30-minute sitting weekly)
or the headed lane (#420) is operational first. Substituting the headed lane for manual Gate-3
revises the standing Q5 decision (Gate-3 = manual Chrome) — that is Chris's call to make
explicitly, not an agent policy edit.

### Step 4 — Users (dogfood starts pre-release; beta from the day v0.5.0 is live) → #425

Dogfood officially (n=1, before submission), unlisted beta (n=5-10), then one public launch with
the DoubleClickjacking demo, then external audit outreach (the P3-09 scope doc finally gets used).
**The public launch is gated on the bridge structural cycle** (#175/#186 + a fresh bridge security
review) — a security product should not invite Show-HN-grade adversarial attention while its
self-declared highest-risk seam carries a known-stale review. Be precise about what users provide
under local-first (D16): their FP data stays on *their* machines — what reaches the maintainer is
qualitative GitHub/store reports plus demand validation. The Program C flywheel and the #232
silence gate are validated against **Chris's own dogfood corpus**; a consented, redacted FP-record
export for beta users would be a new D16-adjacent product decision (worth considering, not
assumed).

### Step 5 — Platform (after users exist)

Firefox port (P4-03; FF-02 is unblocked — AI-4 decided `web-ext`, and the `session_state` shim
prereq is documented), native companion design (#244), ML spike (#245) — each now justified by an
actual installed base and a settled size strategy.

### The next ten slices, in order

| # | Slice | Owner | Issue |
|---|---|---|---|
| 1 | **One batch sitting** (~2h): #321 bloom build + Gate-3 on #273/#356 + measure:fp for #399 + the real-Chrome regression sweep | Human (agent pre-builds the runner + release-path assert) | #321/AI-9, #419, AI-15 |
| 2 | Measurement reset, FP half: Tranco top-1000 + benchmark baseline (post-#321) | Human session | #416 |
| 3 | Corpus methodology v2 | Agent | #417 |
| 4 | Corpus TP re-measure (post-#417) + 72-page failure triage | Agent + short human run | #416, #426 |
| 5 | v0.5.0 tag + unlisted CWS submission (dogfood already running) | Human + agent | #415 |
| 6 | Smart-Mode-Silence CI gate | Agent | #232 |
| 7 | #374 chunk split (budget relief before any capture-growing slice) | Agent | #374 |
| 8 | Bloom runtime refresh + DNR hard-block (permissions declared in v0.5.0 or explicit v0.6.0) | Chris decides hosting/signing; agent implements | #243, #242 |
| 9 | Explanations everywhere + popup truth cluster | Agent | P5-B2, #205/#219/#215 |
| 10 | Distribution: beta → bridge cycle (#175/#186 + review) → public launch | Human-led | #425 |

Supporting process changes (run in parallel, they free the capacity): #422 (stop-rule/priority
ladder), #421 (status-doc collapse), #420 (headed verification lane), #427 (backlog hygiene),
#424 (visual-sim decision).

---

## 5. What "on track" looks like (90-day check)

By roughly 2026-10-01, the project is on track if:

- [ ] v0.5.0 (or later) is installable from the Chrome Web Store; `gh release list` is non-empty.
- [ ] The shipped `reputation_data.bin` is real (m in the millions) and refreshable (#243).
- [ ] A committed post-#321 FP measurement exists at top-1000 scale, and the silence gate (#232)
      runs in CI.
- [ ] A committed corpus-v2 TP number exists with a protected-vs-fired split, and the 72-page
      triage produced a credible path to the 60% target.
- [ ] At least one person who is not Chris uses NavSentinel; at least one external FP/bug report
      exists.
- [ ] The Decision Journal (#237) or its data foundation (#239/#240) has shipped.
- [ ] The autonomous loop spends its cycles on the table above, not on discovery-pass residue
      (#422 enforced).

If most boxes are unchecked, re-read [Course_Correction.md](Course_Correction.md) — the failure
mode it describes has reasserted itself.

---

## 6. Task index

**Seeded by this review (label `strategy`):** #415 (release umbrella), #416 (measurement reset),
#417 (corpus v2), #418 (benchmark truth-up), #419 (Gate-3 batching + re-tiering + WIP cap),
#420 (headed lane), #421 (status-doc collapse), #422 (stop-rule), #423 (claims honesty),
#424 (visual-sim decision), #425 (distribution), #426 (corpus triage), #427 (backlog hygiene).

**Existing spine (label `north-star`):** #232, #237, #239, #240, #241, #242, #243, #244, #245,
#246, #252. Human items: AI-9 (#321), AI-8 (#273), AI-13 (#356), AI-14 (#399), AI-15 (batch
session) — see `ACTION_ITEMS.md`.

---

*Lifecycle note (so this review does not become the drift it criticizes): this document and
[Course_Correction.md](Course_Correction.md) are point-in-time snapshots against `4ad9dd4`. The
live priority order belongs in `Project_Roadmap.md` and the issue tracker, not here — when the
90-day check (§5) is evaluated, fold whatever survives into the roadmap and move both documents
to `docs/archive/`. The #415-#427 issues are grouped under the `strategy` label so the #427
hygiene sweep treats them as a cohort, not residue.*
