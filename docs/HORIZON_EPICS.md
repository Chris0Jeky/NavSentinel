# NavSentinel — Horizon Epics

> **Frozen option portfolio (2026-07-10):** this is not an active backlog.
> [`Product_Strategy.md`](Product_Strategy.md) requires beta evidence and a
> maintainer cull before any epic activates. Duplicate epic issues should be
> closed or moved to an explicitly post-beta milestone. All competitive,
> efficacy, funding, and feasibility statements below are hypotheses from the
> dated design exercise and may not be reused as current claims.

*Created 2026-07-07. A horizon/vision addendum to [`Project_Roadmap.md`](Project_Roadmap.md) and
[`NORTHSTAR_ROADMAP.md`](NORTHSTAR_ROADMAP.md) — **not** a replacement for either, and **not** a
change to the standing ship/measure direction.*

This document maps the highest-leverage **conceptual new mechanics** that move NavSentinel toward
the horizon of a "perfect" interaction-level security tool — and, per the maintainer's brief,
several that grow it **past** the browser-extension form factor. Each epic is a *direction*, not a
sprint. All of it is **milestone-gated behind the v0.5.0 release** (release umbrella #415): nothing
here justifies pausing the release, and the open human items in `ACTION_ITEMS.md` (AI-8/9/13/14/15/16/17)
still come first.

> **These are proposals awaiting the maintainer's cull/ratify.** They are reversible. Chris should
> read this, kill what doesn't fit, and pick a first epic when v0.5.0 has shipped and measured.

## Provenance (how this was derived)

A single-session design initiative (2026-07-07): a 21-agent workflow — 5 codebase readers + 6
external web-research passes (threat landscape, MV3 platform capabilities, competitive landscape,
agentic browsing, on-device detection science, ecosystem/growth) → 6 visionary designers on
distinct lenses (detection intelligence, guardian UX, platform expansion, AI-native, ecosystem,
first-principles wildcard) producing 34 schema-forced epic candidates → 3 adversarial judges
(skeptical principal engineer, product strategist, adversarial security researcher) + a completeness
critic scoring and merging them. The winners below are the cross-judge consensus plus the critic's
two structural additions (agent-verifiable verification; mobile reach). Research figures carry their
source inline; treat fast-moving platform facts (Chrome built-in AI, agentic-browser APIs) as
re-verify-at-implementation.

## The covenant these epics must not break

Every epic preserves the local-first thesis (**D16**): no browsing-data upload,
no telemetry, no password-value storage, and no remote code. The beta makes no
runtime network calls. D26's signed inbound bloom/rule-refresh concept is
historical and deferred; any activation requires a renewed explicit product,
privacy, and release decision. Where an epic adds a channel (model
weights, community rule packs, family config, exported reports) it is **explicit, inspectable,
user-initiated, and signed** — sharing is a human act over a file the user can read, never a silent
pipe. Local-first is a differentiation hypothesis, not proof of exclusivity.
Every claim that an incumbent structurally cannot offer the same benefit needs
fresh competitor evidence before it can become product positioning.

---

## The leverage map (why these compound)

The epics are deliberately a graph, not a list. Three of them are **substrate** — most others
emit into or stand on them:

- **EP-02 Signal Fabric** is the keystone: a typed evidence registry every detector emits into.
  The Narrative Engine, Semantic Sentinel, Agent Conduct, and rule packs all produce
  `SignalContribution`s; Calibrated Judgment calibrates over them; the Flywheel tunes their weights;
  Red Queen attributes evasions to them; the Glass Ledger/journal explains them. Without it, every
  new detector is a cross-cutting edit of `scoring + relief + explanations + journal` against an
  architecture the detection brief says already saturates at ~25 signals.
- **EP-01 Autonomous Proving Ground** is the *velocity* substrate: an agent-drivable headed-Chrome
  verification rig turns "does the prompt actually fire / is the paste actually blocked" into a CI
  artifact, removing the Gate-3 human bottleneck that today throttles every browser-surface slice.
- **EP-03 Calibrated Judgment + EP-04 Attention Budget** are the *FP shock absorber*: they let every
  other detector get aggressive because a noisy new signal costs a journal entry, never user trust —
  turning "zero-FP vs detection breadth" from a trade-off into a governed resource.

Everything else (Trust Ledger, Aftermath, Guardian Circle, Agent Conduct, Proving Ground, Flywheel,
Rule Packs, Companion, Mobile) plugs into that spine.

```
        EP-01 Autonomous Proving Ground ──(verifies)──► every browser-surface epic
                              │
   EP-02 Signal Fabric ◄──────┴──────► EP-03 Calibrated Judgment ──► EP-04 Attention Budget
        ▲  ▲  ▲  ▲                                     │
        │  │  │  └── EP-05 Narrative Engine            │ (confidence feeds the budget governor)
        │  │  └───── EP-06 Semantic Sentinel           ▼
        │  └──────── EP-10 Agent Conduct Layer   (decision journal / Program B surface)
        │                    ▲
        │   EP-07 Trust Ledger ─► EP-08 Aftermath ─► EP-09 Guardian Circle ─► (family / revenue)
        │                    │           ▲
        └── EP-13 Rule Packs │   EP-12 Flywheel + Attack Capsules ──► EP-11 Proving Ground (public)
                             │                                              ▲
              EP-14 Companion (native, far) ── EP-15 Mobile (far) ──────────┘
```

---

# Tier 0 — Force multiplier (start here after v0.5.0)

## EP-01 · The Autonomous Proving Ground — agent-verifiable browser truth

**Horizon:** near · **Effort:** L · **Absorbs/extends:** #420 (headed lane), the Gate-3 posture in
`ACTION_ITEMS.md`, `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md`.

**Problem.** The contract makes Gate-3 manual Chrome testing human-owned because "the agent sandbox
cannot drive a real browser." The strategic review measured the cost: a 10-minute check waited 13
days while ~27 runtime-behavior PRs auto-merged unverified. That single bottleneck caps the entire
fleet's velocity and is the reason most browser-surface North-Star work throttles. No epic in this
document ships at agent speed until this is solved.

**Mechanism.** A hermetic verification rig: headed Chromium under CDP/Playwright with the unpacked
`extension/dist` loaded, deterministic attack-site replay from the gym fixture pack, and assertions
over the *observable runtime* — did the toast/modal actually render (screenshot + DOM), was the
popup navigation actually blocked, did the paste actually get intercepted, did the SW survive a
forced recycle, did a MAIN-world patch throw `Cannot assign to read only property`. It codifies the
project's hardest-won runtime invariants (patch-order #185, SW-hydration, bridge handshake races)
as CI-runnable checks. The conceptual move: **turn "a human must look" into "an agent runs the rig
and attaches the artifact,"** shrinking Gate-3 to a spot-check of genuinely novel UX.

**Implementation.** (1) Rig harness under `tests/rig/` — launch persistent-context headed Chromium
with the built extension, drive gym fixtures, capture screenshot+DOM+journal (agent-buildable; runs
in CI where a display/xvfb is available). (2) Invariant assertion library — the runtime checks above
as reusable matchers. (3) Wire into a `verify:rig` lane and the release pipeline; produce downloadable
traces on failure. (4) **Human-gated once:** Chris validates the rig's verdicts match his manual
Gate-3 on a sample batch, ratifying it as the primary gate (this is the D-2026-07-03-E decision made
real — AI-16 territory). (5) Backfill the ~27 unverified merged PRs' behaviors as rig cases.

**Leverage.** It is the precondition that makes every other epic here safe to build at agent speed,
and it is the substrate the public benchmark (EP-11) secretly requires to score *other* products'
runtime behavior. Highest leverage-per-effort in the whole set because it multiplies the fleet.

**Risks.** Headed Chromium in CI is flaky/heavy — needs ret/quarantine discipline so it doesn't
become the red-CI noise the contract forbids dismissing. It reduces (not eliminates) human oversight
— Chris must ratify the substitution (D-2026-07-03-E is explicitly reserved for his call). Real
agentic-browser testing (EP-10 slice) still needs a human the rig can't replace.

**Dependencies.** v0.5.0 shipped; a CI display environment (xvfb/self-hosted runner) — a real
infra decision; Chris's ratification to make it the primary Gate-3.

---

# Tier 1 — The detection kernel (near)

## EP-02 · Signal Fabric — a typed evidence registry replacing the flat score bag

**Horizon:** near · **Effort:** L · **Absorbs:** #233 (signal-level gating design), the schema half
of #241, the P5-C1 variable-weight residue. **Hard prereq:** #374 chunk split.

**Problem.** The detection brain cannot grow. The engine review documents six strain modes at 5×
signals: `NavigationContext` is a flat ~20-field optional bag; NRS/CDS are linear integer sums with
one global diminishing-returns knee (the OAuth/double-click `+85` dedup is the first of many special
cases); `BENIGN_STRUCTURAL_NRS_FACTORS` is a denylist-by-omission where every new factor silently
becomes an "attack" factor; `reasonCodes`/`nrsFactors` are free strings so scoring, tier-relief, and
explanations drift; threshold tuning is global-per-mode so each new signal multiplies the D25
measurement burden. Every other epic emits signals — onto a structure already at its limit.

**Mechanism.** A signal becomes a first-class record: `{id (enum from schema), magnitude, direction:
attack|benign|structural, confidence, provenance: main|isolated|sw, decayClass, dedupGroup,
necessityInvariant tag, explanationKey}`. NRS/CDS become a **fold over contributions** driven by a
versioned `calibration_profile.json` (weights, caps, dedup groups as **data, not code** — the same
profile the replay harness and Flywheel tune). Structural-vs-attack taxonomy is *declared per
signal*, so top-site tier relief (`top_sites.ts`) and signal-level Smart-Mode suppression derive
from declarations, not hand-maintained lists. Alternative combiners (log-odds / noisy-OR, which
handle correlated evidence honestly) become an offline-evaluable swap. **The registry schema IS the
journal schema** — `PromptOutcomeEntry`'s free-string arrays become typed contribution vectors,
making every stored decision exactly re-scorable (the property Program C was missing).

**Implementation.** Slice 0: the #374 `capture_isolated.ts` lazy-split (this epic must not grow the
70 KB pinned chunk). Slice 1: `shared/signals/registry.ts` schema + codegen the reason-code enum;
adapt `explanations.ts` and `storage.ts` sanitize path (agent-auto-mergeable). Slice 2: refactor
`nrs.ts`/`scoring.ts` to fold over contributions with weights in `calibration_profile.json`; a
fast-check **byte-parity gate** proves old == new across all 122+ gym fixtures + a corpus replay —
zero behavior change. Slice 3: declared `dedupGroups` + structural taxonomy replace
`BENIGN_STRUCTURAL_NRS_FACTORS` and the OAuth/dblclick special case; re-express #233 signal-level
gating as registry predicates. Slice 4: extend `measure-fp.mjs`/corpus lane to emit per-signal
marginal FP/TP attribution. Slice 5 (behind D25 + #232, human-ratified): evaluate log-odds
combination offline; switch only on measured delta. Slices 1–4 are pure logic — ideal fleet work;
only slice 5 touches live scoring.

**Leverage.** The substrate every other epic stands on (see leverage map). Converts "add a detection"
from a four-file cross-cut into declaring one record — the difference between a brain that absorbs
100 signals and one that saturates at 25. Makes explainability *structural*: explanations read the
same registry that scores, so they can't drift.

**Risks.** It refactors the two most fragile areas (the pinned chunk; hand-tuned constant interplay)
— the byte-parity property gate is non-negotiable. Over-abstraction risk for a solo dev is real, but
mitigated: three consumers (scoring, gating, journal) exist day one (global law 8). The log-odds
migration could churn the user-visible 70/50 mental model — it stays optional and measured.

**Dependencies.** v0.5.0; #374; D25 replay harness + #232 for the one behavior-changing slice.

## EP-03 · Calibrated Judgment — conformal confidence and principled abstention

**Horizon:** near · **Effort:** M · **Absorbs:** the conformal half of #241 (as permanent
architecture, not a one-off), #239/#240 as components.

**Problem.** A borderline score has exactly two exits today: prompt (burning the warning-fatigue
budget — Akhawe/Felt's 25.4M-impression study shows fatigue destroys real-world efficacy) or silent
allow (a missed catch). There is no notion of decision *confidence*, so zero-FP Smart Mode and
aggressive new detectors are in direct tension — every detector the Narrative Engine or Semantic
Sentinel adds pays its FP cost in prompts. The adaptive ±15 shift is an uncalibrated stand-in.

**Mechanism.** Conformal evaluation needs **no new model**: the nonconformity measure is the
classifier's own fused score (per Transcend/Transcendent-ICE, validated over 5 years of drifting
malware; abstention lifted drifted precision 0.61→0.89, [IEEE S&P 2022, arXiv:2010.03856]). Each
decision gets *credibility* (p-value of the chosen label) and *confidence* (1 − max other p-value)
against a local calibration set (gym for cold start + the user's own outcome records). Decisions
route on `(score, credibility)`: confident-attack → block/prompt; confident-benign → silent allow;
**low-credibility either way → ABSTAIN** into a Decision-Journal "watchlist" tier (D23-compliant,
zero interruption). Per-class thresholds come from bounded-rejection search (≤ ~25%) on replay. When
rejection balloons, the engine **tells the user its calibration is stale** — epistemic honesty as a
feature no competitor ships.

**Implementation.** Slice 1: `shared/calibration/conformal.ts` — pure ICE with fast-check property
tests + the paper's published reference vectors (perfect sandbox work). Slice 2: calibration-set
builder over the outcome store; gym + Tranco FP-run outputs seed cold start (absorbs #239 silent-allow
capture, #240 IndexedDB). Slice 3: **shadow mode** — compute credibility on every decision and
journal it without changing behavior; replay reports kept-F1/rejection curves (extends
`benchmark.mjs`). Slice 4: flip routing behind a flag; abstentions → Side-Panel watchlist (#237
component) — visible-UI + decision-path, Gate-3 held. Slice 5: drift alarm + calibration-refresh in
options. Slices 1–3 fully autonomous.

**Leverage.** The FP shock-absorber that lets everything else get aggressive; produces the
uncertainty signal the Flywheel's active learning needs (ask about exactly the low-credibility
cases); nearly free compute (a p-value against a stored distribution), which matters on the low-end
hardware the elderly-protection segment runs.

**Risks.** Cold-start calibration from gym+Tranco isn't the user's distribution — rejection can
silently balloon (the known Transcend pitfall), so the drift alarm is in-scope, not optional. The
watchlist could become a place real attacks hide un-prompted — bloom-confirmed and high-severity
classes are **never** abstain-eligible. Stats footguns for a solo dev reviewing agent-written math —
property tests + reference vectors are the guard.

**Dependencies.** EP-02 (calibrates over typed contributions; can start against today's scores in
shadow); #239/#240; #237 for the watchlist surface; v0.5.0.

## EP-04 · Attention Budget — interruption as a governed resource

**Horizon:** near · **Effort:** L · **Absorbs/generalizes:** #232 (the silence gate becomes the
budget invariant).

**Problem.** Habituation, not detection, is the dominant failure mode (Akhawe/Felt). Program A
currently treats quietness as a scoring *outcome to tune*, not an *invariant to enforce* — and as
signals grow 5×, per-signal FP tuning multiplies the Gate-3 burden that is already the #1
bottleneck. No security product bounds its own total interruptions by construction; each alert is
always self-justifying, which is exactly why users stop reading them.

**Mechanism.** A governor between scoring and UI. Every candidate intervention carries EP-03's
confidence and competes for a hard **per-week interruption budget**. Winners get the modal/toast;
losers **degrade down a modality ladder** — modal → inline toast → badge tick → journal-only — so no
true positive is ever silently dropped, it just costs less attention. A **severity floor**
(credential high-risk, clipboard-write ClickFix) is always budget-exempt. High-severity overrides
buy *friction* (type-the-domain commitment device) instead of more warnings. The budget is visible
in the Glass Ledger ("I interrupted you twice this month; budget: 4"), and #232's silence gate
generalizes into one CI assertion: **interruptions per benign-corpus week ≤ budget.** The move:
attention as an accounted, spendable, CI-enforced resource — friend-not-alarm becomes machine-checked.

**Implementation.** Slice 1 (autonomous): `shared/attention_budget.ts` — budget ledger via
SW-delegated writes with session-hydration discipline; property tests (modality never escalates
without budget or floor; floor events always surface). Slice 2 (Gate-3): generalize
`smart_prompt_gate.ts` — prompt call-sites in `capture_isolated.ts`/`credential_guard.ts` request an
intervention *level* from the governor instead of directly invoking UI; sequence after #374. Slice 3
(autonomous, measurement network-gated): consume EP-03 credibility as the ranking key; corpus replay
asserts budget compliance (Tranco) + recall preservation (phishing corpus) per D25. Slice 4:
severity-floor as a typed allowlist in the registry. Slice 5 (product + Gate-3): typed-domain
override friction + budget visibility in options. Slice 6 (CI): #232 journeys become the budget gate.

**Leverage.** Converts the FP problem from "tune weights forever" to "bounded harm by construction"
— every future detector becomes cheap because a noisy signal can only cost journal entries. The
enforcement mechanism behind D23. Compounds with the Glass Ledger, Aftermath, and Guardian Circle
(Care Profiles set the elder budget).

**Risks.** A budget can delay a true positive to a lower modality — the severity floor mitigates,
but defining the floor is itself FP/FN-sensitive; measured corpus recall must gate every rollout.
Triple-gating (Smart Mode + conformal + budget) risks over-silencing — the phishing-recall arm is
mandatory. The call-site refactor sits in the most fragile chunk and collides with #374 — sequencing
is load-bearing.

**Dependencies.** EP-03 + #417 corpus v2 (measurement substrate); #232 to generalize; #374 strongly
advised first; the Glass Ledger's typed reason-code registry (shared).

---

# Tier 2 — The brain (mid)

## EP-05 · Attack Narrative Engine — scoring stories, not snapshots

**Horizon:** mid · **Effort:** XL · **Absorbs:** unification of redirect/OAuth/ClickFix statefulness;
extends #237; feeds EP-10's actor lattice.

**Problem.** Real 2026 attacks are multi-step narratives — ClickFix is
copy→instruct→paste; BITB is build-fake-window→harvest; device-code phishing is
out-of-band-code→legitimate-IdP. NavSentinel models these with scattered module-level singletons and
**cliff TTLs** (ClickFix 30 s buffer, OAuth 60 s latches, JS-behavior 5 s window, mutation 5 min
disconnect, redirect chains in the SW). An attacker who stretches an attack past a TTL or splits
steps across module seams walks through, and every cross-signal correlation is reimplemented per
module.

**Mechanism.** Three parts. (1) **EpisodeStore** — a bounded per-tab timeline in the SW, persisted
via `session_state.ts` hydration discipline, onto which `main_guard`, `capture_isolated`,
`credential_guard`, and the SW emit typed events over the verified bridge. **Evidence decays on
curves instead of expiring on cliffs** — time-stretching an attack weakens but never zeroes it, a
structural anti-evasion property. (2) **Narrative grammars** — small declarative state machines
compiled from data (`clipboard_write ∧ instruction_text within episode ∧ subsequent blur-to-external
→ ClickFix narrative, confidence f(Δt)`) that emit `SignalContribution`s into the Fabric, replacing
per-module bespoke correlation with one auditable mechanism (extends `stateMachine.ts`). (3) Episodes
become the natural unit for the Decision Journal: "here is the *story* of what this page tried" is
the friend-advisor promise made real.

**Implementation.** Slice 1: `shared/episode/` types + SW EpisodeStore fed by existing emitters in
**shadow mode** (journal-only, bounded maps). Slice 2: port ClickFix + OAuth correlation to narrative
grammars, still shadow; corpus/gym replay diffs narrative vs legacy (autonomous). Slice 3: **temporal
gym fixtures** — slow-burn ClickFix, split-step BITB, TTL-straddling variants — extending the
evasion-0x series (autonomous). Slice 4: promote narratives to live scoring via Fabric contributions
behind D25 + #232 (Gate-3). Slice 5: the actor-provenance lattice hands off to EP-10.

**Leverage.** Makes **time and sequence** dimensions the attacker must fight — one-shot heuristics
are designable-around in 10 minutes precisely because they're memoryless; every 10-minute evasion
(rename the string, wait 31 s, split the steps) dies against decay curves on a unified timeline. Its
grammars are exactly what Red Queen (EP-11) grades for necessity-invariant robustness.

**Risks.** SW ephemerality is a named fragile seam — this epic multiplies SW-held state; hydration
discipline is mandatory or episodes silently reset on recycle. Slow-decay evidence raises FP risk on
benign patterns (legit copy buttons before real CAPTCHAs) — EP-03's abstention tier is the designed
pressure release. A grammar DSL can become its own maintenance tax — cap it at data-driven state
machines, no interpreter creep.

**Dependencies.** EP-02 (contributions are the output format); v0.5.0 + #374; bridge hardening
#175/#186 (episode events raise the stakes on bridge integrity).

## EP-06 · Semantic Sentinel — a staged on-device semantic organ

**Horizon:** mid · **Effort:** XL · **Absorbs:** #245 (on-device ML spike), the runtime question in
#246 (visual-sim logo-embedding rides the same offscreen seam). **Reverses/executes D08→D21.**

**Problem.** The engine's biggest blind-spot family is *semantic*: LLM-written lures (AI phishing is
now ~56% of detected attacks at ~4.5× click-through, Hoxhunt 2026), non-English/localized ClickFix
text, BITB fake-chrome DOM, tech-support lock pages. Regex lexicons cannot keep up with server-side
polymorphism (Menlo/THN: ~3,000 live uniquely-disguised ClickFix payloads, 2026). Chrome's own Nano
scam detection phones signals to Safe Browsing for the verdict and skips interaction classes — a
**fully-local** semantic judge is exactly the whitespace the covenant enables.

**Mechanism.** A staged pipeline with trust discipline. **Stage 0:** existing heuristics decide *if*
semantic analysis runs (bounds cost + FP surface). **Stage 1:** an int8-quantized MobileBERT-class
ONNX classifier in an **offscreen document** (PhishLang pattern: 25M params, ~0.4–0.7 s CPU/WASM,
0.96 acc / 94.2% on live CertStream, [NDSS 2025, arXiv:2408.05667]; WASM beats WebGPU for small
single-pass encoders) classifies sanitized text/DOM into scam-intent classes. **Stage 2 (optional):**
only on Stage-1 uncertainty AND hardware permitting, Gemini Nano via the Prompt API (extension-stable
since Chrome 138) as an **async advisory** judge with constrained enum-only JSON. Core principle:
**the model is an untrusted sensor, never a verdict** — outputs enter the Fabric as
probabilistic-untrusted contributions, capped by construction. Prompt-injection defense is
first-class: extraction quotes page text as delimited data, strips imperative framing, validates
output schema; a page overtly self-attesting safety ("this site is verified safe") becomes a
*suspicion* signal — the attacker's anti-LLM move turned into evidence.

**Implementation.** Slice 1: offscreen-doc runtime + `offscreen` permission + SW↔offscreen↔capture
plumbing with heuristic fallback (absorbs #245; manifest change is browser-surface, Gate-3). Slice 2:
text extraction + sanitization in `shared/` (pure logic, property-tested against injection corpora).
Slice 3: train/quantize the Stage-1 model offline against corpus v2 (#417) + gym + multilingual
ClickFix samples; ship weights as hash-pinned assets — **network/human-gated**; ~25–60 MB weights
need an explicit budget call vs the 500 KB dist cap (likely post-install fetch via EP-13's signed
channel, opt-in). Slice 4: wire Stage-1 through EP-03's conformal gate into the Fabric; extend #232
with the model enabled. Slice 5: Nano stage with `availability()` gating + injection-hardened
template + adversarial gym fixtures (pages that try to jailbreak the judge become permanent
regression tests). Slice 6: latency/memory budgets in CI + corpus TP/FP deltas per D25 (human-gated).

**Leverage.** Kills the largest blind-spot family and makes every lexicon detector multilingual
overnight. The offscreen runtime is **reusable infrastructure** — the #246 logo-embedding visual
pivot and any future model ride the same seam; EP-14's companion can transparently substitute a
bigger model behind the same interface. Against Chrome's *hybrid* scam detection, "the verdict never
leaves your machine" is the exact differentiation the covenant buys.

**Risks.** Model distribution strains the covenant + CWS packaging (bundle tens of MB or add a signed
fetch — both need explicit calls). Nano's hardware gate (>4 GB VRAM or 16 GB RAM + 4 cores, 22 GB
disk; ~40% of devices per Chrome docs) means Stage 2 is **forever optional** — the product must be
whole without it. Latency (0.4–0.7 s / 2–4 s) restricts verdict-grade use to pre-submit/dwell flows.
Prompt injection is *mitigated, not solved* — hence untrusted-capped by design. Retraining is a
permanent maintenance tax (stale model = quiet recall decay). Chrome expanding its own coverage is a
live rug-pull; the defensible remainder is locality + interaction classes.

**Dependencies.** EP-02 (trust classes + conformal gate); #417 + #426 for training data; EP-13's
signed channel for weight delivery; hardware-gated Nano optional by design.

---

# Tier 3 — The guardian (human trust, near/mid)

## EP-07 · The Trust Ledger & Trust Lens — user-owned relationship memory as the FP-killer prior

**Horizon:** near · **Effort:** L · **Absorbs:** #234 (top-sites tier becomes the ledger's cold-start
prior), P5-A6 familiarity suppression, part of #237; folds in the self-accounting/error-ledger
mechanic (candidate "Glass Ledger") as its recap face.

**Problem.** The #1 measured product risk is false positives (all of Program A exists for this), and
the strongest benign prior known — "you have an established relationship with this site" — is
scattered across five modules with no unified truth (`domain_profile`, `adaptive_scoring`, the
credential trusted-domain model, `smart_defaults`, `top_sites`). Meanwhile the single strongest
anti-phishing signal in the industry — "you have **never** entered a password here before" (password
managers prove it daily) — is unavailable because nothing records credential relationships. A
documented blind spot follows: lookalike detection compares only against the trusted list + BRAND_DB,
so typosquats of domains the user actually *uses* but never marked trusted are invisible.

**Mechanism.** One local ledger keyed by registrable domain (PSL via `domain.ts`): `firstSeen`,
bucketed visit counts, `credentialRelationship` (boolean + timestamps, **never values**), observed
OAuth grants, decisions, adaptive adjustment. Entries are **hash-chained** (SHA-256 over prev-hash +
entry) so the ledger is tamper-evident, and exportable/importable as a locally-signed JSON file
(WebCrypto keypair, never leaves the machine) — portable across a user's browsers/devices by file.
Derived predicates (`isEstablished`, `hasCredentialRelationship`, `isLookalikeOfMyWorld`) feed NRS
relief and the credential guard. **Trust Lens:** on link hover/focus, a passive isolated-world
micro-HUD shows destination truth — redirector-unwrapped target, punycode/homoglyph-normalized
domain, your-relationship status, bloom verdict — from one-shot signals only, **pre-click** (moving
explanation from post-hoc to pre-decision). **Self-accounting recap:** a two-sided monthly ledger —
what was blocked/checked-silently, and *where it was wrong* (FPs the user corrected, overrides that
turned out fine, the adaptive shifts made in response) — backed by deterministic replay of stored
feature vectors. A security product that keeps double-entry books on itself; radical error-honesty is
the one move telemetry-funded incumbents can't copy.

**Implementation.** Slice 1 (pure logic): `shared/trust_ledger.ts` — schema, hash-chain util,
IndexedDB store behind SW-delegated writes; migration adapters reading the five existing sources.
Slice 2 (Gate-3): feed writers — `credential_guard.ts` records `credentialRelationship` at submit,
`capture_isolated.ts` records visits/decisions via bridge→SW (hydration discipline mandatory). Slice
3 (pure logic + corpus replay per D25): read-side — first-password-here evidence,
`isLookalikeOfMyWorld` (Levenshtein/homoglyph vs ledger domains), familiarity relief absorbing
`top_sites` where a real relationship exists (`top_sites` stays the cold-start prior per D22). Slice
4 (human-gated: headed + product decision on default-on vs opt-in): the Lens hover HUD as a **new
small chunk** (respect the pinned budget), sub-5 ms, debounced. Slice 5 (product): export/import +
signing + the monthly recap view (shares #237 surface); family diff-review ("since last month, mom
formed credential relationships with 3 new domains"). Slice 6 (optional, permission decision): seed
`firstSeen` from history via the optional `history` permission for install-day cold start.

**Leverage.** The FP-killer Program A actually needs — familiarity is the best benign prior in
existence, and it compounds: the Aftermath epic gets its map of where the user's credentials live;
Agent Conduct reuses the hash-chain util; the Lens extends Goal 2 to pre-click. Occupies ground no
cloud vendor can touch (they can't own your relationship history without telemetry) and opens the
family-guardian path with nothing but signed files.

**Risks.** The ledger is a **sensitive artifact** — a dossier of where you have accounts; IndexedDB
isn't encrypted at rest, so the threat model must be documented honestly (a local attacker already
owns the profile) and retention capped. Cold start: on install everything is "first seen" — the
history seed costs CWS-review friction and must stay optional. Hover-HUD noise risks the D23
warning-fatigue lesson — passive, no color-screaming, possibly opt-in. Hash-chain/signing crypto is
easy to get subtly wrong for a solo dev — agent adversarial review helps but isn't proof.

**Dependencies.** v0.5.0; #240 IndexedDB; EP-02 for clean predicate integration (slices 1–3 can
proceed against today's relief seam); Gate-3 for slices 2/4; Chris on Lens default + history
permission.

## EP-08 · Aftermath & the Reversible Session — the recovery copilot

**Horizon:** near→mid · **Effort:** L · **Absorbs:** makes #243 compounding (retroactive), shares
capture with #239/#240, hosts P5-C3, extends #237, gives #244/EP-14 its killer use case.

**Problem.** Every security product ends at the warning; nobody helps at the moment of **maximum
need — AFTER the click**. Victims don't know what they exposed (77% of FBI Operation Level Up victims
were unaware they were being scammed, Mar 2026), don't know remediation order, and never learn
whether they're "done." And every detector sometimes loses: fresh domains beat blocklists,
server-side-polymorphic ClickFix beats static heuristics, users click through warnings. Today a miss
is total loss. This is also the moment that mints evangelists and produces the highest-value labeled
data the Flywheel can get.

**Mechanism.** Two linked mechanics. (1) **Incident compiler** over the local journal: given a
suspicion window or a high-confidence trigger (warning overridden AND credentials submitted to a
flagged domain), assemble a causal timeline from data already captured — credential submits (domain
+ field kinds, **never values**), OAuth grants from the TTL latches, clipboard writes from the
ClickFix buffer, nav chains, DOM injections — each exposure mapping to a **typed recovery playbook**
(password rotation via the W3C `/.well-known/change-password` standard, per-IdP OAuth-revocation
console deep-links, session-revocation + forwarding-rule checks, ClickFix aftermath: Run-history
inspection + offline-scan guidance). (2) **Reversible session** — the consequential sinks write an
**exposure ledger** (metadata only, hash-chained, IndexedDB); a new verdict about a domain (the
signed weekly bloom refresh #243 newly flags it, the user hits "this was wrong," or offline replay
reclassifies) sweeps the ledger for intersecting records and raises a persistent recovery badge —
making #243 **retroactive** protection, not just prospective. All link-opening is user-initiated
navigation: zero runtime network, covenant-clean. Checklist state persists locally; the finished
incident exports as a redacted report for a bank, IT person, or family guardian. The journal stops
being a log and becomes **forensic evidence the user owns.**

**Implementation.** Slice 1 (autonomous): `shared/incident.ts` + `shared/exposure_ledger.ts` — pure
logic over EventLog + PromptOutcome + IndexedDB; property tests (invariant: no password values, no
un-consented URLs in any incident object). Slice 2 (autonomous, link-check human-run): declarative
`recovery_playbooks.ts` (JSON exposure-type→steps, `/.well-known/change-password` resolution, per-IdP
revocation links) + a link-freshness script in the network-gated lane. Slice 3 (SW seam, Gate-3 for
badge): retro-verdict sweep — #243 refresh + P5-C3 mislabel publish domain-verdict events; SW sweeps
the ledger, persists the recovery flag via `session_state.ts` (incidentally fixes the
icon-persistence-after-restart quick-win). Slice 4 (Gate-3 + product): "Recovery" tab beside the
Decision Journal (#237) + entry points ("Something feels wrong" in popup; post-override affordance on
block toasts). Slice 5 (product): redacted incident export (extends `exportAll`); feeds Guardian
Circle. Slice 6 (autonomous): compromise-scenario gym fixtures + a journal-replay harness so the
compiler is regression-tested without a browser. Slice 7 (far, design-only until EP-14): native-
companion hooks for OS-side steps (quarantine the download, check post-paste process spawn).

**Leverage.** Converts Program B/C plumbing into the single most recommendable feature in consumer
security — an unoccupied category (Netcraft/Guardio/Chrome all stop at the warning, and structurally
cannot triage without cloud history ingestion). Converts NavSentinel's two structural weaknesses
(blocklist staleness, heuristic misses) into its most differentiated capability. An exposure record
joined to a retro-verdict **is** a labeled true positive — exactly the signal the Flywheel starves
for. Reframes FPs: a tool that helps you recover earns forgiveness a pure alarm never gets.

**Risks.** **Advice liability** — a stale change-password link or wrong revocation path actively
harms a victim mid-crisis (mitigate: conservative generic steps, link-freshness CI, no automated
remediation). The auto-suggest trigger ("you may be compromised") is the highest-FP-cost prompt
possible — pull-first, push only on the narrow override+flagged pattern, conformal-gated. Playbooks
are journalism, not code — ongoing maintenance weight (community PRs via EP-13 help). False
retro-verdicts cause panic — sweeps gate on high-confidence only. `chrome.browsingData` (optional
one-click purge) raises CWS scrutiny — keep it an optional slice.

**Dependencies.** v0.5.0; #237; #239/#240; P5-C1 (landed); #243 (retro-verdict trigger, itself
human-gated on #321/AI-9 network/signing); EP-07's hash-chain util; Gate-3; Chris on `browsingData`
+ remediation copy.

## EP-09 · Guardian Circle — family protection without a cloud (and the sustainability seam)

**Horizon:** mid · **Effort:** L · **Absorbs:** the family-tier monetization thesis (the critic's
"Sustaining Engine" gap); pricing/positioning under #425.

**Problem hypothesis.** A dated design pass linked large reported elder-fraud
losses to several attack families NavSentinel explores and hypothesized that
adult children might pay for privacy-preserving help. It did not prove buyer
demand, competitor absence, setup feasibility, or fit between those losses and
the current detectors. Fresh caregiver/user interviews and a current competitor
map are prerequisites. NavSentinel currently has no second-person product model.

**Mechanism.** Three pieces, covenant-pure because the transport is human. (1) **Provisioning:** the
guardian's extension generates a local WebCrypto keypair and exports a **signed Guardian Bundle** —
strict presets, senior-tuned plain-language phrasing, ClickFix/tech-support emphasis, a curated
allowlist of the parent's real sites — imported on the parent's machine via file or QR; guarded
settings lock behind the guardian signature, and the parent can always eject (autonomy is a feature).
(2) **Digest:** a weekly, locally-rendered, self-contained HTML digest from the Decision Journal
("3 fake-CAPTCHA pages blocked, 1 new site trusted") that the **parent chooses** to share over any
channel — share-back is parent-initiated, never automatic. (3) **The distribution
and revenue hypothesis:** a successful guardian setup could create two installs;
interviews must establish who pays, what remains free, and whether guardian
tooling or a benchmark is independently valuable. No paid tier or licensing
model is decided. Funding
examples in the original design pass are historical and must be re-researched
when this frozen epic is considered; GitHub Sponsors is a tip jar, not a plan.

**Implementation.** S1 (agent): preset architecture over `storage.ts` + EP-13 rule selections; a
"senior" preset (strict 50 threshold, tightened `mediumRiskThreshold`, simplified copy) that **must
itself pass the #232 silence gate** — a senior preset that nags is worse than none. S2 (agent): signed
bundle format — Ed25519 via WebCrypto, import/verify + settings-lock in options; property tests. S3
(agent + Gate-3): digest generator — journal aggregates → printable asset-free HTML, exported from
#237. **S4 (HUMAN-GATED, the kill-gate):** guardian onboarding — a "set up for a family member" path
with QR/file handoff, **tested with real non-technical users**; the epic dies here if file-based
provisioning fails mom-testing. S5 (HUMAN-GATED, product): positioning + the paid tier + CWS listing
+ a Featured-badge review against the then-current official criteria; no present
  eligibility or review-time assumption.

**Leverage hypothesis.** If buyer interviews, current competitor research, and
an unaided setup test all pass, this could create a referral loop and a distinct
buyer/user model. It is not viral by construction, willingness to pay is not
proven, and privacy is not an exclusive claim. The senior preset and digest
would still pressure-test quietness and plain-language explanation.

**Risks.** File/QR provisioning may lose to cloud UX with real families — S4 is deliberately an early
kill-gate. Support burden: the least technical segment on earth, supported by a solo dev. **Ethics
tightrope:** guardian tooling drifts toward surveillance with every "just add remote alerts" request
— the parent-initiated-share line must be constitutional even when it costs sales. Monetization
tension with free-forever needs an explicit public promise early. One false block that keeps a parent
off their bank uninstalls the product for the whole family.

**Dependencies.** Stable v0.5.x with Gate-3-verified (EP-01!) releases; #237; meaningful #232
progress (senior-preset prereq); EP-13 S1–S3 helpful; pricing/positioning under #425 (human).

---

# Tier 4 — The frontier (mid)

## EP-10 · Agent Conduct Layer — seatbelt and flight recorder for agentic browsing

**Horizon:** mid · **Effort:** XL · **Absorbs/extends:** #237 (Decision Journal becomes an Action
Journal superset), #240; complements #435; consumes EP-05's actor-lattice handoff.

**Problem.** Agentic browsers (OpenAI Atlas, Perplexity Comet, Gemini "auto browse" in stock Chrome,
Claude for Chrome — all Chromium, all extension-capable) execute clicks, fills, and navigations in the
same DOM NavSentinel already watches. The attack record is damning: Brave's Comet OTP-exfiltration and
"unseeable" screenshot injections, ShadowPrompt zero-click into Claude's Chrome extension (patched
v1.0.41), UW's result that same-origin policy collapses to "the strength of the agent's injection
defenses." OpenAI's CISO calls prompt injection "a frontier, unsolved problem." Vendor confirmations
are **self-graded** (fox guarding henhouse) and **no one ships an independent audit trail** — the
research brief ranks an extension-resident agent-action journal as the strongest-fit, near-zero-
competition opening. NavSentinel's gesture-token state machine already distinguishes human gestures
from synthetic events: the primitive is ~80% built but never reified.

**Mechanism.** Four mechanics. (1) **Actor attribution** — extend the gesture state machine +
`main_guard` interposition to label every consequential event `{human-gesture | page-synthetic
(isTrusted=false) | agent-suspected (isTrusted=true but no pointer trajectory, inhuman inter-event
timing, mechanical typing cadence)}`, emitted as a Fabric contribution (not a verdict). (2) **Conduct
policies** — user-set rules evaluated at the sinks NavSentinel already owns: `credential_guard.ts`
submit ("automated actor may never submit a password"), a payment-field classifier ("never pay"),
`main_guard` navigation ("agent must confirm cross-site"), download gating — enforcement reuses the
existing modal/rollback, keyed on actor. (3) **Flight recorder** — a hash-chained, HMAC'd journal
(reusing EP-07's chain util) of every agent-attributed fill/submit/nav/download, rendered in the #237
side panel, exportable: the tamper-evident audit trail no vendor provides. (4) **Injection sentry** —
reuse the CDS invisibility machinery + mutation monitor to flag machine-readable-but-human-invisible
text (Brave's exact vector) as an annotate-only chip; a **visible** warning overlay is ingested by
screenshot-reading agents too, warning both principals at once.

**Implementation.** Slice 1 (pure logic): actor-classification + typed provenance field in bridge
messages (versioned bump); property tests over synthetic traces. Slice 2 (agent): flight-recorder
writer (SW-delegated, hash-chained, IndexedDB) + Action-Journal view in #237. **Slice 3 (HUMAN-GATED,
the hinge — run first among browser work):** headed calibration matrix — Chris runs a scripted
30-minute checklist in Chrome auto-browse, Comet, and Claude for Chrome recording real agent event
signatures; agents then freeze signatures into gym fixtures (Playwright's CDP input is a faithful
in-sandbox simulator of debugger-driven agents for slices 1–2, but real-vendor `isTrusted` semantics
are unverified). Slice 4 (agent): injection sentry + fixtures modeled on Brave's published payloads,
annotate-only per D23. Slice 5 (product): provenance-conditioned default policies, off by default
behind an "I use an AI browser agent" onboarding toggle. Slice 6: device-code/consent-context
detection (the ConsentFix gap — "this device code arrived via a cross-origin referral from a domain
first seen today"), consumer coverage that exists nowhere.

**Leverage.** Occupies the newest **zero-consumer-coverage frontier** (LayerX/SquareX pivoted fast
but sell enterprise SOCs; consumer is empty) on ground where NavSentinel's independence is
structurally unmatchable — an agent vendor can never credibly audit itself. Provenance sharpens every
*existing* detector (a page-synthetic click on a consequential sink is damning evidence today's
`fast_attempt`/`user_activation` only gesture at). The flight recorder is the credibility artifact for
press and grants (Mozilla Builders' local-AI theme, NLnet). And it reuses nearly every existing seam,
so marginal cost is low relative to strategic reach.

**Risks.** **Market timing** — AI browsers are ~1–3% of browsing (eMarketer 2026) and may stay niche;
hence mid-horizon and mostly reusing seams. **Platform rug-pull** — Atlas extension support is
unofficial; vendors could sandbox agent actions away from content scripts, or Chrome could ship a
"good enough" native work-log (the durable counter is *independence + tamper-evidence*, not feature
count). `isTrusted`/event semantics per browser are **unverified** — slice 3 must precede major
investment. Agent-detection FPs on accessibility tooling / legitimate automation — **never block on
agent-suspected alone; annotate-first always**, known-good allowlisting non-negotiable. Hash-chain is
tamper-*evident*, not tamper-*proof* (only as strong as local key storage — state it honestly).

**Dependencies.** v0.5.0; EP-02 (actor/injection contributions; attribution can start before
cutover); EP-07 (hash-chain util); #237 + #240; bridge hardening #175/#186 (trusting attribution
carried over the bridge); slice 3 needs headed Chrome + agent-browser installs + Chris's time —
batch into an AI-15-style session (cheap once EP-01 exists).

---

# Tier 5 — The ecosystem (near→far)

## EP-11 · The Proving Ground — necessity invariants, a self-adversarial gym, and the open benchmark

**Horizon:** near (internal) → far (public) · **Effort:** L · **Absorbs:** #418 (Safe-Browsing arm
gets a permanent home), #416 (measurement reset), #417 (corpus v2), #426 (TP triage); the in-product
inoculation "Dojo" as a delivery face.

**Problem.** The maintainer's own question — "what would an attacker NOT design around in 10 minutes?"
— has a structural answer the project lacks: today's gym proves *non-regression against known
variants*, not *robustness against the adjacent variant an attacker writes tomorrow*. Meanwhile every
efficacy claim is self-referentially validated (the Safe-Browsing benchmark arm has never run;
`benchmark-baseline.json` `lastRun: null`), the "only extension that detects…" store headline is
unevidenced, and the growth brief identifies the gym as potentially the project's **most defensible
external asset** — currently invisible to the world. No shared vocabulary even exists for
interaction-level attacks, so Chrome Enhanced Protection, Edge's scareware blocker, Opera Paste
Protect, and extensions cannot be compared on any footing.

**Mechanism.** Three faces of one asset. (1) **Necessity invariants** — each detector documents, *in
code* (a tag in EP-02's registry), the thing the attack **cannot avoid** and still be the attack:
ClickFix must write the clipboard and induce a paste elsewhere; DoubleClickjacking must retarget
between the primed click and the second; BITB fake chrome cannot produce real window geometry;
credential theft must move the secret off-origin. CI then proves the detector keys on the *invariant*
by verifying it survives invariant-**preserving** mutations (rename strings, restyle overlays,
re-encode text) and correctly ignores invariant-**breaking** ones (the FP dual). (2) **The mutation
loop** — `gym/mutators/` applies evasion axes (localization/Unicode/CSS encoding, timing stretch, step
splitting, LLM-rewritten lure text); every surviving evasion auto-becomes a fixture **plus a capped,
milestone-gated issue** — the fleet's proven red-team strength pointed at its own detectors under the
icebox discipline that already tamed the discovery loop. (3) **The public benchmark** — extract the
gym + corpus + FP harness into a standalone versioned repo with a TTP taxonomy and a Playwright
**adapter contract** that scores ANY defense (Safe Browsing baseline via #418, Edge scareware, Opera
Paste Protect, Guardio) on detection AND false-positive cost — the MITRE-ATT&CK-Evals / privacytests.org
move for browser scam defense, with NavSentinel deliberately publishing the cases it fails. A
by-product delivery face: curated fixtures become an in-product **inoculation Dojo** (Cambridge
prebunking — experiencing an attack safely reduces later susceptibility), executed in a CSP-sealed
`srcdoc` iframe narrated by the *real* scorer, with a CI trace-sync gate so lessons can never drift
into theater.

**Implementation.** Slice 1 (agent): invariant annotations on existing detectors + the `gym/mutators/`
Playwright framework (extends the evasion series; sandbox-runnable). Slice 2 (agent): LLM-assisted
lure/mutation generation offline — generated fixtures are **committed, never runtime-generated** (the
corpus stays deterministic). Slice 3 (agent): robustness scoreboard wired into the perf/corpus lanes,
advisory. Slice 4 (agent, then Gate-3): fix waves for surviving evasions behind D25 + #232; the
inoculation Dojo runner as a lazy-loaded extension page with its own perf-budget line. Slice 5 (mid):
promote the scoreboard to a **blocking gate** for new detectors — EP-05/EP-06 detectors are born
graded. **Slice 6 (HUMAN-GATED end to end): the public spin-out** — taxonomy doc + `navsentinel-bench`
repo + third-party scoring (baselines via the #420/#460 headed lane — the class of run that already
caught a "bare Chromium has no Safe Browsing" methodology error once), submission/appeals policy,
licensing, journalist outreach — decided by Chris; ties into the parked P3-09 external-audit outreach.

**Leverage.** The forcing function that keeps every other epic honest — grammars, classifiers, and
calibration all get graded on the *adjacent-variant* attack, not the fixture they were built against,
which is the only engineering answer to "10-minute evasion." It weaponizes the fleet's demonstrated
strongest skill (adversarial review that routinely finds HIGHs) as a permanent asset. The public
benchmark converts NavSentinel's best artifact into **ecosystem gravity a zero-marketing solo project
cannot buy any other way**: the honest-scoreboard maintainer gains influence independent of market
share (privacytests.org precedent — Chrome changed behavior in response), it finally breaks the
self-referential validation loop, and it is the artifact that makes NLnet/Mozilla-Builders funding
credible. Google structurally cannot publish this — it would spotlight Safe Browsing's
interaction-level blindness.

**Risks.** **Recidivism is the gravest risk** — this is structurally the old self-feeding discovery
loop wearing armor; it **must** inherit the icebox/milestone gating and a hard cap on open red-team
residue, or it re-consumes the project. Publishing the benchmark also publishes an evasion manual —
publish invariants + methodology while embargoing fresh surviving-evasion classes. **Credibility is
all-or-nothing** — one public methodology error costs more than the benchmark earns; adversarial
review of methodology must be a standing gate, and NavSentinel topping its own scoreboard needs
reproducibility + published failures + external co-maintainers to survive the conflict-of-interest
optics. Benchmark maintenance is the unpaid-EasyList-labor trap — the standalone repo only ships if
funding or co-maintainers materialize. Benchmarking commercial products may touch their ToS (human
legal sanity pass).

**Dependencies.** v0.5.0; EP-02 for invariant tags + per-signal attribution (slices 1–3 can start
against current code); absorbs #416/#417/#418/#426; #420 headed lane (and EP-01) for baseline arms;
public spin-out gated on funding/user-base signals.

## EP-12 · The Local Flywheel & Attack Capsules — self-tuning + replayable real-world corpus

**Horizon:** mid · **Effort:** XL · **Absorbs:** #239/#240/#241 (the tuning + input side), P5-C3,
de-fangs #426. **Hard prereq:** #374.

**Problem.** Program C built capture plumbing but nothing closes the loop — months of
`PromptOutcomeEntry` records improve nothing, and the records can re-score but never **re-witness**,
so when a novel ClickFix variant slips through or a benign flow false-positives, the evidence
evaporates on navigation and FP reports are unreproducible. Home-user labels are brutally scarce (a
handful/month, not the ~80/day research ceiling), so every label must be maximally informative — yet
nothing selects *which* decisions deserve a question. And the strongest benign prior available —
THIS user's own years of history/bookmarks — sits unused (a latent Thesis-Review idea no task owns).

**Mechanism.** Two linked engines. (A) **Attack Capsules** — on any flagged event or user "report
this," the isolated world snapshots a bounded **rrweb-lite** capture (serialized DOM at decision
time + the timestamped mutation stream the monitor already observes + the full registry decision
trace) into IndexedDB. A **sanitizer with property-tested guarantees** — *allowlist* serialization
only (all input values, cookies, storage, query strings, user-identifying DOM stripped by
construction, never by blocklist) + a mandatory human preview — produces a portable capsule. A
compiler emits a gym-format fixture + Playwright spec, so a capsule **is** a benchmark case and a
rule-authoring test. Sharing is file-export only; nothing auto-sends, ever. (B) **The Flywheel** —
three closed local loops: (i) *label acquisition* — margin/uncertainty sampling over EP-03's
credibility picks ≤ ~2 decisions/week as one-tap "did we get this right?" cards in the journal (never
a prompt, per D23); (ii) *tuning* — an idle-scheduled job replays the entire local corpus under
candidate `calibration_profile.json` deltas and proposes a diff the user applies with one click
(protective direction never auto-relaxed); (iii) *priors* — behind an explicitly opt-in, default-off
history/bookmarks permission, a trust-graph builder emits per-user structural contributions ("you've
visited this origin 400 times over 3 years"). The tuned profile is exportable, inspectable JSON — a
person can audit exactly what their instance learned.

**Implementation.** S1 (agent): capsule schema (superset of `PromptOutcomeEntry` + DOM snapshot +
mutation stream) + IndexedDB store under #240's `unlimitedStorage`, size caps + eviction; and the
event↔outcome linkage + silent-allow completeness (#239). **S2 (BROWSER-SURFACE, Gate-3; HARD PREREQ
#374):** capture engine as a **lazy-loaded** module (the pinned chunk cannot absorb it) hooking the
existing MutationObserver + a decision-time serializer, node/depth bounded. S3 (agent,
adversarial-review-heavy): the sanitizer — allowlist serializer with fast-check properties + a
dedicated red-team round. S4 (agent): capsule→fixture compiler + replay lane so #241's offline tuning
+ conformal calibration consume real capsules; CI replays capsules to verify determinism; the
uncertainty-sampled feedback cards (#237 surface, Gate-3). S5 (Gate-3 + product): export/donate UX
with a preview-diff of exactly what leaves; profile export/import + human-readable diff. S6 (human-
gated): trust-graph builder behind the optional permission; a curated researcher-facing capsule
corpus with a citation policy.

**Leverage.** The **moat no funded competitor can copy** — Guardio/Netcraft/Chrome improve by pooling
telemetry (their business models *are* the telemetry), so "your instance gets smarter and nothing
ever leaves the machine" is structurally uncontested. It is the flywheel hub: users → capsules →
fixtures (EP-11) → rules (EP-13) → better protection → more users; it assembles the one asset scarce
for the whole field (labeled, replayable, real-world interaction attacks) — a citation magnet and the
training substrate future on-device ML (EP-06) needs. Converts the covenant from "one arm tied behind
its back" into the growth story.

**Risks.** **Honest ceiling** — a handful of labels/month tunes thresholds and priors, not models;
oversell it as "learning" and it reads as snake oil (the trust graph likely delivers more measurable
FP reduction than the labels). Self-tuning on user mislabels can degrade protection — bounded by
human-ratified diffs + never-auto-relax. The history permission is a **trust-optics landmine** for a
privacy product — opt-in, default-off, prominently explained, and the CWS listing must not require
it. **Sanitization is a hard promise** — a single leaked credential/PII fragment in one donated
capsule detonates the entire trust thesis (allowlist-only, mandatory preview, property tests,
adversarial review, no auto-send; accept that some capsules are simply unshareable). Capture cost on
the hot path risks jank — hard dependency on #374 + lazy loading. Meaningless at 0 users — strictly
post-beta.

**Dependencies.** #374 (hard); EP-02 + EP-03 (typed vectors + credibility are the substrate);
absorbs #239/#240/#241 + P5-C3; #237; a live user base; #416 for before/after evidence.

## EP-13 · The Open Immune System — signed community rule packs (data, not code)

**Horizon:** mid · **Effort:** L · **Absorbs:** the community-rules ecosystem; shares the #243 signed
channel.

**Problem.** A solo dev cannot out-iterate server-side-polymorphic ClickFix (3,000 live payloads, 7
new variants in a quarter) by writing TypeScript detectors PR-by-PR — every new lure text, BITB
fake-window shape, or localized CAPTCHA string costs a code change, two review rounds, and a release.
Meanwhile the community-rules niche for *behavioral* scam detection is unclaimed (PhishTank is in
limbo; EasyList proves the model works with ~4 maintainers).

**Mechanism.** A **Rule Pack** is a signed, versioned JSON document of declarative matchers — data,
not code: bounded regex sets (existing D-REDOS discipline) over instruction/clipboard text, DOM-shape
predicates (the BITB signature: an in-page element mimicking window chrome containing a URL-bar-like
text node), URL/redirector patterns, CSS-property predicates — each mapping to an existing evidence
code with a **capped magnitude**. **Safety by construction:** rules can only *raise* evidence, never
lower thresholds and never auto-block — the scoring engine still decides, so a malicious/sloppy
pack's worst case is bounded FPs, never a silent allow. A **bounded evaluator** (fixed operator set,
no `eval`, per-rule time budget, fuzz-tested) keeps the CWS remote-code line defensible (alongside the
DNR precedent). A future delivery design may reuse a newly authorized signed
inbound channel; D26 does not currently authorize it. It must fail closed to
bundled packs, use pinned keys, and provide a **diff-inspectable pack viewer** in options (the
covenant made visible). Contribution follows the EasyList shape: a rule-request forum, fixture-required
CI for pack PRs.

**Implementation.** S1 (pure logic): rule schema + bounded evaluator with fast-check fuzzing of time
budgets/operator bounds, emitting `SignalContribution`s; a starter pack migrates 2–3 existing regex
lists (`clickfix_detector.ts` instruction text is already effectively data). S2: signing/verification
shared with #243 (one channel, two payload types), staleness tracking, fail-closed tests. S3:
options-UI pack inspector — rules rendered in plain English via the `explanations.ts` pattern, update
diffs shown before apply. S4 (human-gated: repo, keys, CWS policy pre-review): contribution workflow
+ the EasyList-shape forum. S5 (mid): non-English/localized ClickFix lure packs — the detection
brief's named blind spot — as the first community-sourced content proving the loop.

**Leverage.** Converts NavSentinel's two most defensible assets (the fixture gym, the covenant) into
flywheels: rules-as-data multiplies the solo dev (pattern updates ship in days without touching the
trusted codebase, and pack+fixture+replay-delta is exactly the autonomous fleet slice shape). Packs
emit into the Fabric, target the #1 threat class, and feed Guardian/Companion users fresher
protection with **no cloud verdict service**.

**Risks.** **CWS policy is the big one** — Google could read packs as remotely-hosted logic despite
the data-not-code design; mitigations (bounded evaluator, raise-only, bundled fail-closed default,
user-visible diffs) must be documented for review, with bundled-only packs at release cadence as the
fallback. Community may not show up pre-users — S1–S3 must be self-justifying as internal iteration
speed. Malicious/low-quality rules cost FPs — capped magnitudes + fixture-required CI + signed
curation bound the blast radius, but curation + signing-key custody become critical solo-dev
infrastructure. Version the format from day one (a weak DSL v1 needing breaking changes post-adoption
is expensive).

**Dependencies.** v0.5.0; #243 signed-fetch infra (#321/AI-9 lineage); EP-02 evidence codes (soft —
adapters possible first); human gates: keys, community repo/forum, CWS policy pre-review, headed
verification of the update flow (EP-01).

---

# Tier 6 — Beyond the browser (far — the maintainer explicitly invited this)

## EP-14 · Sentinel Companion — the native daemon that closes the OS gap

**Horizon:** far · **Effort:** XXL · **Absorbs:** #244 (native-companion design spike) as slice 1.

**Problem.** Three attack/architecture gaps are provably out of reach of ANY extension: (1) ClickFix's
kill chain completes **outside** the browser — the victim pastes into Win+R/PowerShell/Explorer, where
the extension can only warn at copy-time; (2) EP-06's best models exceed browser quotas and Nano's
hardware gate excludes ~40–60% of devices; (3) CSP-header blindness (#179), cross-origin iframe
opacity, and SW ephemerality have no MV3 fix — the North-Star audit itself routes them to "the unbuilt
companion."

**Mechanism.** The signature mechanic is **cross-layer clipboard taint tracking** — a browser-to-OS
correlation nothing consumer ships: when `clickfix_detector.ts` flags a suspicious clipboard write,
the extension passes a **salted hash + taint metadata** of the payload over native messaging; the
companion watches system-side paste events, and when a browser-tainted payload lands in a shell-class
target (Run dialog, terminal, Explorer address bar — via foreground-window classification), it
**interdicts at the moment of execution** — closing the loop the extension can only narrate. Around it:
a **model host** exposing EP-06's `generate()`/`classify()` interface backed by llama.cpp/Ollama-class
local models (Semantic Sentinel transparently upgrades, no Nano gate); and a **persistence/observation
organ** — durable state surviving SW recycling, response-header/CSP capture (closes #179), DNS-anomaly
checks — all **loopback-only, zero network egress by default, auditable open source, installed by an
explicit separate user act.**

**Implementation.** Slice 1: protocol design doc + native-messaging host manifest + minimal echo
companion with version handshake (absorbs #244; agent-buildable). Slice 2: clipboard-taint handoff
(`clickfix_detector.ts`→`sw.ts`→native pipe carrying salted hashes with TTL; extension side pure
plumbing, agent-buildable; end-to-end needs a real OS — human-gated). **Slice 3: Windows paste-sentinel
— the single highest-value, highest-risk slice** (clipboard-sequence listener + foreground-window
classification + interdiction UI; heavily human-gated: OS behavior, Defender false-flag risk, UX).
Slice 4: model host implementing EP-06's interface (extension prefers companion > Nano > WASM >
heuristics; agent-buildable against a mock, model integration human-verified). Slice 5: header/CSP/DNS
observation feeding Fabric evidence (closes #179 on Chrome). Slice 6: signed installer, auto-update,
macOS port — pure distribution weight, human-gated.

**Leverage.** Could convert NavSentinel's ClickFix detection story from a
warning into prevention at the point of harm, potentially distinguishing it
from extension-only approaches. That is a hypothesis requiring a current
benchmark, not a competitor-absence or Safe-Browsing claim.
Dissolves EP-06's hardware gate, gives EP-05/EP-08 durable state, and is the **escape hatch** if Chrome
tightens MV3 or closes the agent aperture (the intelligence lives in a process Google doesn't control).

**Risks.** The **largest honest risk in the portfolio** — an installer, code-signing certs, per-OS
clipboard/window APIs, an update channel: XXL permanent maintenance for a solo dev, and it should not
start until the extension has proven retention. A privileged local daemon is itself an attack surface
(sandbox, loopback-bind, minimal). Clipboard/foreground hooks pattern-match spyware — AV false-flags
and user distrust are likely (open source + signed + no network mitigates, but the optics tax is real).
Install friction caps adoption at a fraction of extension users. Opera-style native features or MS
OS-level ClickFix mitigations could obsolete slice 3.

**Dependencies.** #244 as slice 1; EP-06's runtime interface defines the model-host contract; EP-02
receives companion evidence; **requires proven extension retention (user base) and an explicit
maintainer commitment to a second deliverable** — a category-defining bet, not a backlog item.

## EP-15 · Sentinel Mobile — go where the victims actually are

**Horizon:** far · **Effort:** XL · **New direction (completeness critic).**

**Problem.** Every epic above assumes desktop Chrome MV3 — but pig-butchering, smishing,
WhatsApp/Telegram investment scams, UPI/M-Pesa fraud, and in-app-browser phishing dominate **global**
fraud losses, and the highest-loss victim segments skew mobile. A perfect desktop detector excludes
most actual scam victims (the critic's "beautiful engine with no car"). Non-Western scam grammars and
the accessibility needs of elderly/low-confidence users are unowned across the whole set.

**Mechanism.** A staged mobile beachhead reusing the portable core (EP-02 Signal Fabric + EP-13 rule
packs are platform-agnostic data + pure logic by design). **Android first:** Firefox-for-Android and
Edge support extensions, giving the content-script guard a real home; plus a share-sheet / Accessibility-
Service "check this link / screenshot" scanner that runs the lure classifier (EP-06) and rule packs on
demand — even a degraded "paste-a-link triage + screenshot OCR against the classifier" protects more
real victims than any desktop detection refinement. **iOS:** a Safari Web Extension in advisory mode
(`xcrun safari-web-extension-converter` is feasible for content-script/DNR-style extensions).
Cross-cutting, folded in here because they are mobile-adjacent and the set otherwise ignores them:
**accessibility** (screen-reader-compatible prompts, cognitive-load-appropriate warnings for the elderly
Guardian Circle targets) and **non-Western scam grammars** (localized ClickFix/CAPTCHA text, regional
payment-fraud flows) sourced via EP-13 community packs.

**Implementation.** Slice 1 (agent): confirm the portable-core boundary — audit which `shared/` modules
are already platform-agnostic (Fabric, scoring, domain, rule evaluator) and which assume `chrome.*`;
route the rest through the `browser.ts` shim + a thin platform-capabilities layer. Slice 2 (agent +
Gate-3 on real devices): Android via the web-ext toolchain (AI-4 already chose web-ext) targeting
Firefox/Edge Android; the classifier + rule packs run; UI adapts to mobile. Slice 3 (human-gated:
device + store): the share-sheet/Accessibility-Service on-demand link/screenshot scanner (Android-native
thin shell calling the WASM classifier). Slice 4 (human-gated: Apple Developer account, App Store):
Safari Web Extension advisory port. Slice 5 (agent + community): accessibility pass on all prompt
surfaces + the first non-Western localized rule packs (EP-13). Nearly every runtime-verification slice
is human-gated on real devices — EP-01's rig should be extended to Android emulators where possible.

**Leverage.** Reaches the victims desktop never will, and forces the portability discipline (Fabric +
rule packs as the portable core) that keeps the architecture honest. Accessibility + i18n are
correctness for the exact users Guardian Circle monetizes. It is the difference between a tool for
"privacy-conscious desktop Chrome users who can install extensions" and a tool for the people losing
the $11.37B.

**Risks.** Mobile extension platforms are thin and shifting (Firefox/Edge Android extension support is
narrower than desktop; Safari is advisory-only with App Store friction and no Gemini-Nano equivalent).
Accessibility-Service permissions on Android are a trust/abuse-optics minefield (they're the same APIs
malware requests). Store distribution (Apple especially) is real overhead for a solo dev. This is a
far bet that only makes sense once the desktop core + rule ecosystem are proven — but naming it now
keeps the portable-core boundary a design constraint from EP-02 onward rather than a costly retrofit.

**Dependencies.** EP-02 (portable core) + EP-13 (portable rule packs) as the reusable substrate; EP-06
classifier for the scanner; AI-4 web-ext decision; proven desktop retention; real-device Gate-3 (extend
EP-01).

---

## Recommended sequencing (all post-v0.5.0, all milestone-gated)

This is *impact-per-effort* ordering, not a commitment — Chris picks. Nothing starts before v0.5.0
has shipped and the AI-8/9/13/14/15/16/17 human items clear.

| Wave | Epics | Rationale |
|---|---|---|
| **0 — Unblock the fleet** | EP-01 | Removes the Gate-3 bottleneck; every later browser-surface slice depends on it. Pairs with #374 (owed structural debt). |
| **1 — Lay the kernel** | EP-02, then EP-03 + EP-04 | The substrate + the FP shock absorber; unlocks aggressive detection without an FP penalty. Absorbs #232/#233/#239/#240/#241 cleanly. |
| **2 — Guardian value (ship-visible)** | EP-07, EP-08 | Highest user-love-per-effort; makes the covenant legible and turns misses into the product's second act. Mostly reuses landed plumbing. |
| **3 — Brain + honesty** | EP-05, EP-11 (internal faces), EP-06 | Temporal + semantic depth, kept honest by necessity-invariant grading. EP-11 slices 1–5 are internal; the public spin-out waits. |
| **4 — Flywheel + ecosystem** | EP-12, EP-13, EP-09 | Data + community + growth/revenue loops — meaningful only with a user base. Guardian Circle S4 is the family-UX kill-gate. |
| **5 — Frontier + reach (bets)** | EP-10, EP-11 public spin-out, EP-14, EP-15 | Agentic-audit frontier and beyond-the-browser bets; each gated on a real trigger (agentic adoption, funding, proven retention). |

## Honest cross-cutting caveats (the completeness critic's warning, kept in view)

- **Convergence:** the 34 candidates were really ~10 ideas — the design space around "make detection
  better for users we already reach" is well-explored and near-saturated. The genuinely *new* ground
  is outward: agentic audit (EP-10), reach/mobile (EP-15), and the ecosystem/benchmark authority play
  (EP-11). Weight future effort there, not toward a 40th detection heuristic.
- **Distribution & money are load-bearing, not optional:** EP-09 carries the revenue thesis and EP-11
  the authority/citation channel; a local-first tool that can't fund its maintainer is a security
  failure for the elders depending on it. Apply for NLnet NGI Zero / Mozilla Builders early.
- **Accessibility & non-Western scam grammars** are folded into EP-13 (community packs) + EP-15
  (accessibility pass) but deserve first-class attention the moment Guardian Circle targets elders.
- **Platform rug-pull is a portfolio risk:** Chrome could ship "good enough" versions of EP-06
  (already partially — Nano scam detection) or a native agent work-log (EP-10). The durable moats are
  the ones big players *structurally* cannot take: locality/no-telemetry (EP-06/EP-12), independence
  (EP-10's flight recorder), user-owned data (EP-07), and open-benchmark authority (EP-11).

## Issue map

Seeded as GitHub issues labeled `epic` (2026-07-07). Detail lives here; issues are compact trackers.

| Epic | Issue | Epic | Issue | Epic | Issue |
|---|---|---|---|---|---|
| EP-01 Autonomous Proving Ground | #439 | EP-06 Semantic Sentinel | #444 | EP-11 Proving Ground | #449 |
| EP-02 Signal Fabric | #440 | EP-07 Trust Ledger & Lens | #445 | EP-12 Flywheel + Capsules | #450 |
| EP-03 Calibrated Judgment | #441 | EP-08 Aftermath | #446 | EP-13 Open Immune System | #451 |
| EP-04 Attention Budget | #442 | EP-09 Guardian Circle | #447 | EP-14 Sentinel Companion | #452 |
| EP-05 Narrative Engine | #443 | EP-10 Agent Conduct Layer | #448 | EP-15 Sentinel Mobile | #453 |

Labels: all `epic`; EP-09/11/13/15 also `strategy`.
