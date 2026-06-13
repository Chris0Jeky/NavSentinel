# NavSentinel North-Star Roadmap — Phase 5

*Created 2026-06-13. An addendum to [`Project_Roadmap.md`](Project_Roadmap.md), not a replacement.
Phase 5 is the "North-Star" track: the four programs that take NavSentinel from a strong
interaction-level detector to a **near-zero-false-positive, explainable, self-tuning security
companion.** It uses the same conventions as the main roadmap (task IDs `P5-{prog}{seq}`, effort
S/M/L/XL, task table → details → gate).*

## Provenance (how this was derived)

This track is grounded in a 2026-06-13 research + audit initiative (all artifacts under `docs/research/`):

| Artifact | What it is |
|---|---|
| [`NORTHSTAR_AUDIT_SYNTHESIS.md`](research/NORTHSTAR_AUDIT_SYNTHESIS.md) | Internal code audit synthesis — 14 subsystems/hunts, **153 adversarially-verified findings** (11 critical / 51 high), against `main @ da400fb`. |
| [`NORTHSTAR_AUDIT_FINDINGS.md` / `.json`](research/NORTHSTAR_AUDIT_FINDINGS.md) | The full finding ledger with file:line evidence + verify verdicts. |
| [`NORTHSTAR_RESEARCH_EXTERNAL.md`](research/NORTHSTAR_RESEARCH_EXTERNAL.md) | External SOTA (broad pass): on-device AI, warning science, Tranco/conformal, competitive landscape, Side Panel. |
| [`NORTHSTAR_RESEARCH_GAPFILL.md`](research/NORTHSTAR_RESEARCH_GAPFILL.md) | External SOTA (gap-fill): on-device ML runtime cost, interaction-attack rates, visual-phishing SOTA. |
| [`NORTHSTAR_RESEARCH_GAPD.md`](research/NORTHSTAR_RESEARCH_GAPD.md) | External SOTA (GAP-D, 24 verified claims): conformal rejection (Transcend/Transcendent), feature-snapshot + rrweb, active learning on a tiny labeling budget. (Synthesis cut by a session limit; claims stand.) |
| [`NORTHSTAR_RESEARCH_HANDOFF.md`](research/NORTHSTAR_RESEARCH_HANDOFF.md) | The original framing + resume notes (superseded by the above, kept for history). |

Every finding cited below was adversarially verified against the code (internal) or by 3-vote
adversarial verification against primary sources (external). Where line numbers appear they were
spot-checked against `main @ da400fb`; treat them as drift-prone anchors, not contracts.

## The four vision goals (what Phase 5 is judged against)

1. **Zero-FP Smart Mode** — silent during normal use (SSO, OAuth popups, 3DS, SPAs, marketing
   redirects, cloud-hosted apps) yet still catches real interaction-level attacks.
2. **Friend-advisor UX** — every decision (block, prompt, silent score, suppressed signal)
   explainable in plain language via a decision journal / verbose mode.
3. **Live feedback capture** — at every decision, snapshot rich state into a local labeled
   corpus for continuous, offline tuning (single user, privacy-unconstrained *locally*).
4. **Architecture leverage** — exploit where Chrome MV3 limits the product via a Firefox build,
   a native-messaging companion, on-device ML, and DNR — soberly, by ROI.

## Current standing vs the goals (audit verdict)

| Goal | Maturity | The structural hole |
|---|---|---|
| 1 · Zero-FP Smart Mode | **~70%** | Smart Mode gates at *mode* level, not *signal* level (`capture_isolated.ts` decision path); no top-sites trust prior; `intent_mismatch_under_interactive` not container-aware. |
| 2 · Friend-Advisor UX | **~30%** | Building blocks exist (`explanations.ts`, `debug_overlay.ts`) but no user-facing decision journal; silent allows emit zero events; reason codes render raw in options/popup. |
| 3 · Feedback Capture | **~40%** | `storage.ts` plumbing is production-grade but `PromptOutcomeEntry` (storage.ts:55) is too thin to re-score/retrain offline; nav path drops `reasons` the credential path keeps. |
| 4 · Architecture | **scoped, blocked** | Escape hatches scoped but unrealized; bloom filter is build-time-only (staleness); Firefox blocking-`webRequest` unwired; native companion undesigned. |

---

## Decision Log (Phase 5 additions)

| # | Decision | Rationale / evidence |
|---|---|---|
| **D21** | **Revisit D08 "No ML at this stage" → conditional on-device ML is now in-thesis.** | D08 deferred ML to "Phase 4 if heuristics plateau." Research confirms on-device inference is viable in an MV3 **offscreen document** (ONNX-runtime-web / TF.js, WebGPU default-on since Chrome 113), and Chrome itself now ships local Gemini Nano scam detection. ML enters as a **conditional enhancement with a heuristic fallback**, never a hard dependency — preserves the local-first thesis (D16). |
| **D22** | **Top-sites prior must use a FILTERED list, never raw Tranco/Alexa.** | Tranco NDSS'19: raw top-lists are manipulable (rank 28798 reachable with one HTTP request; 4 phishing domains in the Alexa top-10k). Use Tranco's hardened list, *further filtered*, as a benign **prior** that lowers (never zeroes) intervention — combined with bad-signal overrides. |
| **D23** | **The advisor channel is a non-interruptive Decision Journal (Chrome Side Panel), not more prompts.** | Warning-fatigue literature (Akhawe/Felt 2013, 25.4M impressions; Porter-Felt 2016): interruptive warnings habituate and lose efficacy. The friend-advisor goal is met by an on-demand journal/Side Panel (Chrome 114+, no host permissions), keeping prompts rare. |
| **D24** | **Visual-sim pivots from perceptual-hash to logo-embedding (Siamese/CNN); pHash stays only as a cheap pre-filter.** ✅ **Confirmed by maintainer 2026-06-13.** | USENIX'21 Phishpedia (logo + Siamese): 98.2% precision / 87.1% recall / 0.19s/page, far above pHash/EMD/PhishZoo/LogoSENSE. On-device pHash (PhishSnap) is feasible but low-accuracy. This re-scopes **P4-01c** and **moots the original AI-5** (screenshot-derived pHash templates) → AI-5 re-scopes to reference brand *logos*. |
| **D25** | **Instrument before tuning. No scoring/threshold change ships without a corpus-replay FP/TP delta and a Smart-Mode-Silence gate.** | The audit found all tuning today is guesswork because the capture payload can't be replayed. Rich capture (P5-C1) + a replay harness (P5-C5) + a CI silence gate (P5-A1) are prerequisites to every FP change. |
| **D26** | **Bloom-list refresh gets ONE signed, integrity-checked network fetch — the single documented exception to D16.** ✅ **Decided by maintainer 2026-06-13.** | The bloom filter is build-time-only and goes 30–90 days stale (audit: critical). A ~weekly **signed** refresh (verify signature before applying; fail-closed to the bundled list) keeps detection fresh with minimal thesis compromise. All other runtime no-network rules stand; the native companion (P5-D4) remains the longer-term structural path. |

> **Local-first thesis (D16) is preserved across all of Phase 5.** No runtime telemetry leaves the
> machine. On-device ML and the native companion are local; the *only* runtime network touch is a
> **single signed, integrity-checked bloom-list refresh** — approved as the one documented D16
> exception (**D26**), fail-closed to the bundled list.

---

## Program A — FP-Elimination (Zero-FP Smart Mode)

**Goal:** Smart Mode is silent on the named benign flows (SSO, OAuth, 3DS, SPA, marketing
redirects, cloud-hosted logins, password-manager autofill) while interaction-level detections
stay intact. **Measured** by a CI silence gate, not asserted.

### Task table

| ID | Title | Effort | Depends on | Cross-ref |
|---|---|---|---|---|
| P5-A1 | Smart-Mode-Silence CI gate (instrument before tuning) | M | P5-C1 (richer signal helps isolate cause) | extends `scripts/measure-fp.mjs` |
| P5-A2 | Signal-level Smart-Mode gating (suppress benign-context prompts) | M | — | — |
| P5-A3 | Top-sites trust-tier prior (filtered) + threshold = f(tier) | M | — | builds on `domain_groups.ts`, `domain_profile.ts` |
| P5-A4 | `intent_mismatch_under_interactive` container heuristic | S | — | adjacent #217 |
| P5-A5 | Scorer FP fixes bundle (redirect buckets, pushState path, modal backdrop, JS-behavior allowlist) | M | — | adjacent #207/#223 (oauth), #225/#226 (iframe) |
| P5-A6 | Engagement/familiarity suppression + apply adaptive adjustment to live threshold | M | P5-C1, P5-A1 | #213, #204 |

### Details

**P5-A1 — Smart-Mode-Silence CI gate.** Today `scripts/measure-fp.mjs` only visits a homepage +
3 link clicks; it never exercises the vision flows. Add scripted **benign journeys** (multi-step
SSO + credential submit, OAuth redirect popup, 3DS hop, SPA route churn, marketing redirector,
cloud-hosted login, password-manager autofill) and assert **prompts-per-100-benign-pages ≈ 0** as a
blocking CI gate. *Done when:* the gate runs in CI, fails on any benign-flow prompt, and emits a
per-factor attribution of each prompt. *Files:* `scripts/measure-fp.mjs`, new gym journey fixtures,
`.github/workflows/*`.

**P5-A2 — Signal-level Smart-Mode gating.** In the `capture_isolated.ts` navigation decision path,
gate prompts on *context*, not just `nrs < blockThreshold`: suppress when the destination is a
known IdP (okta/auth0/accounts.google/login.microsoftonline) on an OAuth/SSO callback with
`oauthRedirectMismatch===false`; when source↔dest are same-org via `areSameOrganization`; on a
recognized 3DS/payment-processor hop; and on a user-activation-active short-gesture click with no
CDS risk. *Done when:* the 9 fp-hunter benign scenarios produce no Smart-Mode prompt and the
attack gym fixtures still fire. *Files:* `extension/src/content/capture_isolated.ts`,
`extension/src/shared/nrs.ts`.

**P5-A3 — Top-sites trust-tier prior.** Bundle a **filtered** top-sites tier at build time (per
**D22** — hardened Tranco/CrUX, filtered of adult/gambling/streaming, intersected with no-bad-signal),
same local-first pattern as PSL/bloom. Define tiers — (1) user-allowlisted → silent; (2) top-tier +
no bad signal → silent unless high-confidence interaction attack; (3) seen-before-benign (from
`domain_profile`) → relaxed; (4) unknown → normal; (5) bloom/known-bad → strict — and set the
intervention threshold as `f(tier)`. *Done when:* a top-tier site that trips a lone heuristic does
not prompt, while a tier-5 site is unaffected; bundle size within budget. *Files:* new
`scripts/build-topsites-tier.mjs`, new bundled asset, `extension/src/shared/nrs.ts`,
`extension/src/shared/domain_groups.ts`.

**P5-A4 — `intent_mismatch_under_interactive` container heuristic.** The one measured Tranco FP
(unity3d.com class). In `scoring.ts`, don't flag when the top element is container-like
(`nav`, `div[role=navigation]`) with no action intent; log the DOM relationship for the journal.
*Done when:* the measured FP clears; attack fixtures unaffected. *Files:* `extension/src/shared/scoring.ts`.

**P5-A5 — Scorer FP-fix bundle.** Split the shared redirect allowance into per-kind buckets
(form-submit vs location — legit multi-step checkout exhausts the 2-redirect budget today); add a
pushState domain-like-path whitelist for semver/service segments; broaden `detectLegitModalBackdrop`
to recognize CSS-class modals (`modal`/`dialog`/`overlay`) and large legit overlays (video/cookie/
a11y), not just `role=dialog`; pass the allowlist into the JS-behavior monitor so cross-origin exfil
signals to allowlisted/payment origins are skipped; expand the marketing-redirector allowlist. *Done
when:* each sub-fix has a benign+attack gym pair. *Files:* `main_guard.ts`, `pushstate_guard.ts`,
`scoring.ts`, `js_behavior_monitor.ts`, `sw/*redirect_chain*`.

**P5-A6 — Familiarity suppression + surface/repair adaptive adjustment.** Use `domain_profile.ts`
visit history to relax thresholds on habitual sites. **Note (verified against `main`):** `adaptiveAdj`
is **already applied** to the live decision threshold — `getNrsBlockThreshold()` returns
`base + adaptiveAdjustment` (`capture_isolated.ts:1177-1179`) and the click decision uses that value as
`blockThreshold`. So the remaining work is **not** "apply it" but: **surface/explain** the effective
threshold in the journal (P5-B) and **fix the discount-nullification bugs** (#213/#204) so the learning
actually moves the threshold. *Done when:* familiar-site prompts drop measurably on the P5-A1 gate
without TP loss. *Files:* `adaptive_scoring.ts`, `nrs.ts`, `capture_isolated.ts`. *Cross-ref:* #213, #204.

### Program A gate
- [ ] P5-A1 silence gate green in CI across all named benign journeys (prompts/100 ≈ 0).
- [ ] No regression on the attack gym fixtures or the phishing corpus TP.
- [ ] Trust-tier prior live; adaptive adjustment applied and bounded.

---

## Program B — Friend-Advisor (Decision Journal / Verbose Mode)

**Goal:** the user can answer "*why did NavSentinel allow / block / prompt this, and when?*" for
**every** decision — including the silent majority — without an interruptive prompt (per **D23**).

### Task table

| ID | Title | Effort | Depends on | Cross-ref |
|---|---|---|---|---|
| P5-B1 | Emit silent-decision events (`nav_silent_allow`, `cred_form_evaluated`) | S–M | — | #219, #205, #215 |
| P5-B2 | Wire `explainReasonCode` into all surfaces + coverage audit | S–M | — | #216, reputation codes |
| P5-B3 | Decision Journal UI in the Chrome Side Panel | L | P5-B1, P5-C1 | — |
| P5-B4 | Verbose mode (promote `debug_overlay` to a user-readable per-event card) | M | P5-B1 | — |
| P5-B5 | Recovery + feedback affordances on block toasts + inline mode help | S | — | reuses `ui_toast.ts` |

### Details

**P5-B1 — Silent-decision events (the keystone).** Three independent audit agents flagged that
silent allows emit zero events, so the journal and the popup gauge see only the loud ~5%. Add a
`nav_silent_allow` EventKind emitted in the `decision==='allow'` branch with
`{score, reasonCodes, nrsFactors, adaptiveAdj, threshold}`, and `cred_form_evaluated` for silently
passed credential forms. *Done when:* normal browsing produces a reviewable event stream; popup gauge
reflects the live page. *Files:* `capture_isolated.ts`, `credential_guard.ts`, `storage.ts`
(EventKind), `shared/event_tone.ts`. *Cross-ref:* resolves the data-foundation half of #219/#205/#215.

**P5-B2 — Wire explanations everywhere + coverage audit.** `explainReasonCode` is used only in
toasts today. Wire it into options event-log rows, popup signal chips (hover/`title`), and the
credential modal (which shows raw labels). Coverage audit: every user-reachable reason code —
including `SRI_MISSING_ON_CREDENTIAL_PAGE`, `CONTENT_FP`, `nrs_domain_repeat_offender`, CSP codes —
must have an `explanations.ts` entry. *Done when:* no raw reason code is ever shown to a user.
*Files:* `explanations.ts`, `options/*`, `popup/*`, `credential_modal.ts`.

**P5-B3 — Decision Journal (Side Panel).** Build a persistent, non-interruptive **Chrome Side Panel**
(`chrome.sidePanel`, Chrome 114+, needs only the `sidePanel` permission — a privacy win) that merges
EventLog + PromptOutcome by domain + time proximity into a reverse-chron timeline. Per entry:
timestamp, source→dest, decision, **score vs effective threshold (base + adaptive)**, factor breakdown
in plain English, user verdict. Filter by kind/domain; CSV/JSON export. *Done when:* every decision
type (block/prompt/silent allow/suppressed signal/trust/threshold shift) appears with a plain-English
"why." *Files:* new `extension/src/sidepanel/*`, `manifest.json` (`sidePanel` permission),
`popup_model.ts` (reuse decision logic), repurpose `debug_overlay.ts` layout.

**P5-B4 — Verbose mode.** A toggle that promotes `debug_overlay`-grade detail (full CDS/NRS factor
breakdown + plain-English why + "what would have happened") into a user-readable per-event card in the
journal. Keep it off by default; warning science says the loud channel stays rare. *Files:*
`debug_overlay.ts`, sidepanel, options toggle.

**P5-B5 — Recovery + feedback affordances.** Add "Add to allowlist" / "Undo (<5s)" to *block* toasts
(prompt toasts already have them); add inline help for Smart/Strict/Off and the trust-button
semantics. Reuse the underutilized `ui_toast.ts` multi-action framework. *Files:* `ui_toast.ts`,
`capture_isolated.ts`.

### Program B gate
- [ ] Silent decisions are visible and explained; no raw reason codes in any UI.
- [ ] Side Panel journal renders every decision type with plain-English "why" + effective threshold.
- [ ] Explanation-coverage metric = 100% of user-reachable codes.

---

## Program C — Feedback-Capture (Live Local Tuning Loop)

**Goal:** every decision writes a **replay-grade** labeled record to a local corpus, so weights and
thresholds can be re-tuned offline and validated by replay before shipping (per **D25**).

> **Research status:** the targeted **GAP-D re-run completed** (24 verified claims,
> [`NORTHSTAR_RESEARCH_GAPD.md`](research/NORTHSTAR_RESEARCH_GAPD.md)) — P5-C5's conformal design is now
> externally grounded. Key results: split/**inductive conformal** (Transcend ICE) with **NCM = the
> detector's own decision score / distance-to-threshold** (algorithm-agnostic, no retraining);
> **credibility** = p-value of the chosen label, **confidence** = 1 − max p-value of the others;
> **quarantine low-credibility** decisions for the human; per-class thresholds via constrained random
> search (maximize kept-F1, minimize rejected-F1, **bounded rejection ≤ ~25%**); margin/uncertainty
> sampling μ(θ,x)=1/(1+μ|θᵀx|) for the tiny labeling budget; rrweb = deterministic DOM snapshot +
> timestamped mutations (sampling config to bound size).

### Task table

| ID | Title | Effort | Depends on | Cross-ref |
|---|---|---|---|---|
| P5-C1 | Enrich `PromptOutcomeEntry` → replay-grade feature vector | S–M | — | storage.ts:55 |
| P5-C2 | Capture the full distribution (silent allows + ignore/timeout outcomes) | M | P5-C1, P5-B1 | #188 residual |
| P5-C3 | "This was wrong" mislabel affordance → labeled corpus | S | P5-C1 | #213, #204 |
| P5-C4 | Storage + export for the flywheel (IndexedDB + event↔outcome linkage) | M | P5-C1 | #203 (atomic import) |
| P5-C5 | Offline tuning + corpus-replay harness + conformal calibration | L | P5-C1..C4 | GAP-D ✅ researched |

### Details

**P5-C1 — Enrich the capture record (the load-bearing change; six audit agents converge here).**
`PromptOutcomeEntry` (storage.ts:55) is `{id, ts, domain, destDomain?, type, score, outcome,
reasons?}` — and the nav path even drops `reasons` that the credential path keeps. Add optional
fields: `reasonCodes[]`, `nrsFactors[]` (factor→value), `cds`, `navAnomalyScore`, `adaptiveAdj`,
`thresholdUsed`, serialized `ElementHint` context; populate them at **every** `appendPromptOutcome`
site (fix the nav-vs-credential inconsistency). Much of this is wiring — the data already sits in
`lastDebug` and is discarded before storage. *Done when:* a stored record can be offline re-scored to
reproduce the live decision. *Files:* `storage.ts`, `capture_isolated.ts`, `credential_guard.ts`.
**This one change unblocks both Program B (explainable journal) and Program C (tunable corpus).**

**P5-C2 — Capture the full distribution.** Record **silent allows** (reuse P5-B1's `nav_silent_allow`)
so the corpus has safe-domain ground truth, not just contested edges; record nav-prompt
`ignore`/`timeout` outcomes via `pagehide`/`beforeunload` (today page-unload destroys the toast before
`onDismiss`, so abandoned prompts are lost). *Files:* `capture_isolated.ts`, `ui_toast.ts`, `storage.ts`.

**P5-C3 — Mislabel affordance.** One-tap "this was wrong" on every intervention surface flips a
`wasWrong`/`label` field in the record and discounts FP-labeled outcomes in `computeAdjustment`.
Cheap, single-user-friendly; converts the behavior log into a supervised training set. *Files:*
`ui_toast.ts`, `credential_modal.ts`, `adaptive_scoring.ts`, `storage.ts`. *Cross-ref:* fix #213/#204
discount bugs here.

**P5-C4 — Storage + export for the flywheel.** Move from the ~500-entry `chrome.storage.local` ring
to **IndexedDB + `unlimitedStorage`** for an unbounded single-user corpus (privacy-unconstrained
locally); add `eventId` foreign-key linkage between EventLog and PromptOutcome; enrich the existing
`exportAll()` schema (the export *path* exists — the gap is schema richness, not the mechanism).
*Files:* new `extension/src/shared/corpus_store.ts` (IndexedDB), `storage.ts`, `options/*` (export).

**P5-C5 — Offline tuning + replay harness + conformal calibration.** A Node harness that ingests the
exported corpus, re-tunes NRS/CDS weights (logistic regression over feature→verdict pairs), and
**replays** the corpus to measure FP/TP delta before any scoring change ships (the D25 gate). Layer
**conformal rejection** (Transcend-style per-class credibility + p-values; abstain/defer under drift)
calibrated to a single human's tiny labeling budget. *Files:* new `scripts/replay-corpus.mjs`,
new `scripts/tune-weights.mjs`, `adaptive_scoring.ts`. *Design grounded by* [`NORTHSTAR_RESEARCH_GAPD.md`](research/NORTHSTAR_RESEARCH_GAPD.md): Transcend **ICE** (NCM = NavSentinel's own NRS/CDS score — no retraining; credibility/confidence p-values; quarantine low-credibility prompts into the mislabel loop; bounded-rejection threshold search) + margin sampling μ(θ,x)=1/(1+μ|θᵀx|) to pick the few events worth labeling.

### Program C gate
- [ ] A stored record offline-reproduces its live decision (replay parity).
- [ ] Silent allows + ignore/timeout outcomes captured; corpus is label-able.
- [ ] Replay harness produces an FP/TP delta; no scoring change ships without it (D25).

---

## Program D — Architecture & Platform (Escape Hatches)

**Goal:** exploit the highest-ROI escape hatches from MV3's ceilings, soberly. **Posture:** harden the
Chrome extension in place, ship the Firefox build for true blocking, design a native companion for the
structural wins, add conditional on-device ML — and **recommend AGAINST a browser fork** (the
Chromium-rebase treadmill is a full-time team's job; extension + companion + Firefox-blocking delivers
~all the value at a fraction of the cost).

### Task table

| ID | Title | Effort | Depends on | Cross-ref |
|---|---|---|---|---|
| P5-D1 | declarativeNetRequest hard-block fed by the bloom list | M | — | the only MV3-native *prevent* |
| P5-D2 | Bloom filter runtime refresh + staleness tracking | M | D26 ✅ (one signed refresh) | — |
| P5-D3 | Firefox build FF-02→FF-04 (blocking `webRequest` + header CSP) | L | AI-4 ✅ decided (`web-ext`) | P4-03; **prereq below** |
| P5-D4 | Native-messaging companion — design spike + scoping | M (design) / XL (build) | product decision | — |
| P5-D5 | On-device ML offscreen-doc spike (revisits D08/D21) | M (spike) | — | — |
| P5-D6 | Visual-sim pivot to logo-embedding (re-scopes P4-01c) | L | AI-5 (deferred → pivot decision) | P4-01c, D24 |
| P5-D7 | Bridge + cross-frame hardening | M | — | #186, #175, #181 (existing) |

### Details

**P5-D1 — DNR hard-block.** Research **refuted** the worry that MV3 DNR can't carry large blocklists.
Feed the bloom known-bad set into **dynamic `declarativeNetRequest` rules** to *prevent* navigation to
known-bad domains — the only MV3-native way to block rather than react (today NavSentinel only
reacts/rolls back). Confirm `declarativeNetRequest` is wired at all (audit flagged it may be unused).
*Files:* `sw/sw.ts`, `manifest.json` (DNR permission), new rule-builder from `reputation.ts`.

**P5-D2 — Bloom runtime refresh.** The bloom filter is build-time-only → users run 30–90 days stale
against hourly threat feeds (audit: **critical**). **Decided (D26): one signed, integrity-checked
weekly refresh** — verify the signature before applying, **fail-closed to the bundled list** on any
error, track staleness in `chrome.storage.local`, age-graceful degradation, timestamp header in the
`.bin`. This is the single documented exception to D16; the native companion (P5-D4) remains the
longer-term structural path. *Files:* `scripts/build-bloom-filter.mjs`, `reputation.ts`, `sw/sw.ts`,
`manifest.json` (host permission for the one signed endpoint).

**P5-D3 — Firefox build (the biggest unrealized lever).** FF-01 (`browser.*` shim) + `manifest.firefox.json`
are merged but unwired; **AI-4 is now decided → `web-ext`** (Chris, 2026-06-13), so FF-02 implements
against the Mozilla `web-ext` toolchain + a separate `manifest.firefox.json` build script. Firefox's retained
**blocking `webRequest`** enables true pre-commit blocking and HTTP-header CSP inspection (structurally
closes #179 on FF). **PREREQ (verified bug):** `session_state.ts` hardcodes `chrome.storage.session`
at lines 191/224/232/259 and never routes through `storageSessionShim` — on Firefox this crashes on
hydrate. **Fix the shim routing before FF-03.** *Files:* `vite.config.*`, new `src/sw/background.html`
(FF-02), `session_state.ts` + `browser.ts` (FF-03 prereq), `manifest.firefox.json`.

**P5-D4 — Native-messaging companion (highest ceiling).** This is the "antivirus-like" escape hatch.
Scope a Go/Rust `nativeMessaging` helper for what no extension can do: DNS inspection, persistent state
(no SW death), heavy ML inference, **CSP-header capture** (closes #179 structurally), download scanning,
subframe/cross-origin validation. Deliverable for this slice is a **design doc + scoping**, not the
build (XL). Native-host install friction is acceptable for a single-user dev machine. *Files:* new
`docs/design/native_companion.md`, a minimal `nativeMessaging` handshake PoC.

**P5-D5 — On-device ML offscreen-doc spike (revisits D08 → D21).** Validate ONNX-runtime-web / TF.js
in an MV3 **offscreen document** (WebGPU default-on Chrome 113+; the SW can't host inference). Wrap
Chrome's **Prompt API (Gemini Nano)** as a *conditional* page/scam classifier behind a
`LanguageModel.availability()` check with a heuristic fallback — its hardware bar (>4GB VRAM **or**
16GB RAM + 4 cores, 22GB free disk; ~40% of devices) means it can never be a hard dependency. **Budget
caveat:** peak inference memory can far exceed model-on-disk size — measure against the perf budget;
respect the single-offscreen-document cap. *Files:* new `extension/src/offscreen/*`, design notes.

**P5-D6 — Visual-sim pivot (re-scopes P4-01c; per D24).** Pivot the confirmation stage from
perceptual-hash to **logo CNN/Siamese embeddings** (Phishpedia-class: 98.2% precision / 87.1% recall)
or an on-device VLM; keep pHash only as a cheap pre-filter. This **likely moots AI-5** (screenshot-derived
pHash templates become unnecessary). Honesty caveat: Phishpedia is an *identification* system assuming
a candidate is already flagged, with limited in-the-wild brand coverage — pair it with the existing
brand/domain-mismatch signal as the flag. *Files:* `visual_sim_*`, `scripts/build-brand-templates.mjs`
(replace pHash templates with an embedding model), offscreen host (P5-D5).

**P5-D7 — Bridge + cross-frame hardening.** Mostly existing issues, grouped: SW-vouched init auth
(**#186** — bridge authenticates port possession, not isolated-world identity); add a **periodic**
liveness ping/pong beyond the one-time init check (**#175** — a dead port after verification silently
swallows all signals); route `recordNavigation` through the single-threaded SW to fix the per-frame
`domain_profile` race (**#181**). *Files:* `main_guard.ts`, `bridge_outbound.ts`, `domain_profile.ts`,
`sw/sw.ts`.

### Program D gate
- [ ] DNR hard-block live on the bloom set; bloom staleness tracked + refreshable.
- [ ] Firefox build (web-ext) runs with the `session_state` shim prereq fixed; blocking `webRequest` exercised.
- [ ] Native-companion design doc + on-device-ML spike landed; visual-sim pivot decision recorded.

---

## Top-10 priorities (impact-per-effort, across programs)

| # | Slice | Effort | Why first |
|---|---|---|---|
| 1 | **P5-A2** signal-level Smart-Mode gating | M | Directly attacks goal 1 where the verified FPs cluster. |
| 2 | **P5-C1** enrich the capture record | S–M | One change unblocks goals 2 **and** 3; mostly wiring. |
| 3 | **P5-A3** top-sites trust-tier prior | M | Highest-ROI structural FP lever. |
| 4 | **P5-B1** silent-decision events | S–M | Data foundation for the journal *and* the corpus. |
| 5 | **P5-A4** intent_mismatch container heuristic | S | Kills the one measured Tranco FP. |
| 6 | **P5-B2** wire explanations everywhere | S–M | Dictionary already exists; stops raw codes. |
| 7 | **P5-D2** bloom runtime refresh | M | Confirmed-critical TP erosion. |
| 8 | **P5-C3** mislabel affordance | S | Turns the corpus into labeled training data. |
| 9 | **P5-A6 / #213 / #204** surface + fix adaptive adjustment | S–M | Adjustment is already applied; fixing the discount bugs makes the existing learning actually reduce FPs. |
| 10 | **P5-D4** native-companion design spike | M | Highest-ceiling escape hatch; design now, build later. |

**Quick wins (S-effort, immediate):** P5-A4, P5-C1 (partial — populate `reasonCodes`/`nrsFactors` at
nav sites), P5-B1, P5-B2, P5-C3, P5-B5, marketing-redirector allowlist (part of P5-A5), persist
icon/badge to `SessionStateManager`, add CSP/SRI/repeat-offender entries to `explanations.ts`.

## Existing assets to leverage (don't rebuild)
`scoring.ts`/`nrs.ts` (principled, gated), `domain_groups.ts` + `domain_profile.ts` (trust-tier
substrate), `adaptive_scoring.ts` (just apply + feed it), `storage.ts` (`exportAll` exists),
`session_state.ts` `SessionStateManager` (add journal/icon keys), `explanations.ts` (the advisor
dictionary), `debug_overlay.ts` (repurpose for the journal card), `ui_toast.ts` (multi-action),
`credential_modal.ts` (accessible), `browser.ts` (FF on-ramp), `measure-fp.mjs`/`benchmark.mjs`
(CI-gate them). Full list: [`NORTHSTAR_AUDIT_SYNTHESIS.md` §8](research/NORTHSTAR_AUDIT_SYNTHESIS.md).

---

## Open human-owned items (see `ACTION_ITEMS.md` — status as of 2026-06-13)

- **AI-4 → ✅ DECIDED (`web-ext`).** Chris chose option (b) `web-ext` + `manifest.firefox.json` —
  matching the audit recommendation. **P5-D3 is unblocked**: implement FF-02 against web-ext. Don't
  forget the verified `session_state.ts` shim-routing prereq (FF crashes on hydrate without it).
- **AI-5 → ✅ DECIDED: pivot to logo-embedding (2026-06-13).** The original screenshot ask is moot.
  **Re-scoped:** AI-5 now = "supply or sanction a set of reference brand *logos*" for the embedding
  model (or confirm using a public logo set). The pHash path is retired to a pre-filter. Feeds **P5-D6
  (#246)** and the on-device-ML host **P5-D5 (#245)**.
- **AI-3 → ✅ RESOLVED.** `fix/jsb-stale-todos-and-tests` superseded by merged work (branch gone;
  `computeJsBehaviorScore` is now a live function, not a dead stub). No action remains. (#231 tracks any
  residual cleanup.)

## Open research
**GAP-D — ✅ DONE (2026-06-13).** The targeted re-run completed (24 verified claims,
[`NORTHSTAR_RESEARCH_GAPD.md`](research/NORTHSTAR_RESEARCH_GAPD.md)); P5-C5 is now externally grounded.
No open research gaps remain in the North-Star track. (Re-verify the fast-moving Chrome built-in-AI
specs at implementation time, per the gap-fill caveats.)

## Mapping to existing GitHub issues (avoid duplicates)
Several audit findings already have issues — fold them into the relevant program rather than re-filing:
#186/#175 (bridge → **P5-D7**), #181 (domain_profile race → **P5-D7**), #179 (CSP → **P5-D4/P5-D3**),
#178 (SRI → P5-B2 coverage), #228 (session_state hydration → **P5-D3** area), #217/#213/#204
(scoring/adaptive → **P5-A4/P5-A6/P5-C3**), #219/#215/#205 (popup gauge → **P5-B1**), #207/#223/#222/#221
(oauth FP → **P5-A2/P5-A5**), #225/#226 (iframe → P5-A5), #231 (jsb cleanup → **AI-3**).

### Tracking issues (filed 2026-06-13, label `north-star`)

| Slice | Issue | Slice | Issue | Slice | Issue |
|---|---|---|---|---|---|
| P5-A1 | **#232** | P5-B1 | **#236** | P5-C4 | **#240** |
| P5-A2 | **#233** | P5-B3 | **#237** | P5-C5 | **#241** |
| P5-A3 | **#234** | P5-C1 | **#238** | P5-D1 | **#242** |
| P5-A4 | **#235** | P5-C2 | **#239** | P5-D2 | **#243** |
| | | | | P5-D4 | **#244** |
| | | | | P5-D5 | **#245** |
| | | | | P5-D6 | **#246** |

Still-unfiled program sub-slices (folded into the program issues or existing issues for now; file
when picked up): **P5-A5** (scorer FP bundle), **P5-A6** (familiarity + surface/fix adaptive — fold
#213/#204), **P5-B2** (wire `explainReasonCode` everywhere), **P5-B4** (verbose mode), **P5-B5**
(block-toast recovery affordances), **P5-C3** (mislabel affordance — fold #213/#204), **P5-D3**
(Firefox build FF-02→FF-04 — tracked under main-roadmap P4-03 + the `session_state` shim prereq #228),
**P5-D7** (bridge/cross-frame hardening — tracked by #186/#175/#181).
