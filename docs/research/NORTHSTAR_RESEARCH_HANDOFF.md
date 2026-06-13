<!-- RESEARCH HANDOFF — created 2026-06-13 by Claude (deep-research session).
     This is a CONTINUATION handoff for a large research+audit initiative whose two
     orchestration workflows were interrupted by an Anthropic session rate-limit before
     producing usable output. Both workflows are persisted and RESUMABLE (see §2).
     This doc also carries SEEDED preliminary findings (§4) so the next session has a
     running start even before the workflows are re-run. Nothing here is verified against
     source files this session — items tagged [VERIFY] must be confirmed by the resumed
     internal-audit workflow against the actual code. -->

# NavSentinel North-Star Research & Audit — Handoff

**Status:** IN PROGRESS — interrupted by session rate-limit 2026-06-13. Resume per §2.
**Goal (verbatim intent):** Make NavSentinel the leading browser security companion —
**near-zero false positives** in everyday "Smart Mode" browsing while staying maximally
protective, a **friend-advisor explainable-decisions UX** (verbose mode / decision journal),
and a **live local feedback-capture loop** for continuous tuning (single user, no
distribution, privacy-unconstrained for *local* capture). Explore escape hatches where
Chrome MV3 limits the product: **Firefox-specific build**, **native-messaging companion
("antivirus-like") process**, or — carefully weighed — an **own browser fork**.

The four vision goals everything is judged against:
1. **Zero-FP Smart Mode** — silent during normal use (SSO, OAuth popups, 3DS, SPAs, redirect
   marketing links, cloud-hosted apps) yet still catches real interaction-level attacks.
2. **Friend-advisor UX** — every decision (block, prompt, silent score, suppressed signal)
   explainable in plain language via verbose mode / a decision journal.
3. **Live feedback capture** — at every intervention, snapshot rich state (scores, factors,
   DOM hints, nav context, user verdict) into a local labeled corpus for tuning.
4. **Architecture leverage** — identify where MV3 limits the product and what Firefox builds /
   a native companion / a fork would unlock, with sober cost/benefit.

---

## 1. What happened this session

- Two background workflows were launched to run the research end-to-end:
  - **`deep-research`** (external state-of-the-art, 5 angles) — all 5 search agents died on
    `session limit · resets 4:30am`. Result: **0 sources, 0 claims.**
  - **`navsentinel-internal-audit`** (13 read-only deep-reads + adversarial verify + synthesis)
    — all 15 agents died on the same limit. Result: **0 findings.**
- **No usable output was produced by either run.** Both are fully resumable (the cache will
  replay any agent that *did* complete — in this case none, so they re-run fresh).
- The model was switched to **Opus 4.8 (1M context)** after the limit reset.
- This handoff was written instead of re-running (usage was again near the cap). The seeded
  findings in §4 are from the maintainer-facing docs already read this session
  (`docs/Project_Roadmap.md`, `autodoc/AGENT_INDEX.md`, `ACTION_ITEMS.md`) + domain knowledge,
  **not** from reading the extension source this session.

---

## 2. RESUME INSTRUCTIONS (do this first next session)

Both scripts are saved under the session workflow dir. Re-invoke with `scriptPath`
(+ `resumeFromRunId` to reuse any cached agents). Run them **one at a time** (or sequentially)
to avoid re-tripping the concurrent-agent limit, and ideally when fresh budget is available.

**External research workflow:**
```
Workflow({
  scriptPath: "C:\\Users\\jekyt\\.claude\\projects\\C--Users-jekyt-Desktop-Printer-Config-Others-Git-NavSentinel\\faf27e79-cd84-48ba-9a57-5617a01cc599\\workflows\\scripts\\deep-research-wf_42f1af38-10c.js",
  resumeFromRunId: "wf_42f1af38-10c"
})
```

**Internal repo audit workflow:**
```
Workflow({
  scriptPath: "C:\\Users\\jekyt\\.claude\\projects\\C--Users-jekyt-Desktop-Printer-Config-Others-Git-NavSentinel\\faf27e79-cd84-48ba-9a57-5617a01cc599\\workflows\\scripts\\navsentinel-internal-audit-wf_4fca375f-64b.js",
  resumeFromRunId: "wf_4fca375f-64b"
})
```

Notes:
- If the harness has garbage-collected the run journals (cross-session), the cache replay is a
  no-op and the scripts simply re-run from scratch — still correct, just no free cache hits.
- The internal-audit script uses `agentType: 'Explore'` (read-only) and a strict READ-ONLY
  mandate. It does NOT modify files. Safe to run anytime.
- Consider running the internal audit FIRST — it's self-contained (no web) and most directly
  actionable; then deep-research to layer external SOTA on top.
- If budget is tight, the internal-audit `TASKS` array can be sliced (run 4-5 keys per turn).

---

## 3. Research framing (preserved — do not lose)

### External (deep-research) — 5 angles
1. **State-of-the-art detection (2024-2026):** on-device ML in extensions (TF.js / ONNX-runtime-web /
   WebGPU, offscreen docs), Chrome built-in AI (**Gemini Nano / Prompt API for extensions**),
   Chrome's own on-device scam/phishing model in Enhanced Safe Browsing, visual brand-impersonation
   (Phishpedia, PhishIntention, VisualPhishNet, PhishLLM), heuristic+ML hybrids, measured TP/FP.
2. **FP-elimination & alert science:** calibration (conformal prediction, per-context thresholds),
   reputation tiers, Tranco/CrUX top-site priors, behavioral baselining/novelty, warning-fatigue &
   habituation research (Felt/Akhawe Chrome SSL-warning studies), explainable warnings.
3. **Competitive landscape:** Netcraft, Bitdefender TrafficLight, Avast, Norton Safe Web, Guardio,
   Malwarebytes Browser Guard, MS Defender Browser Protection, McAfee WebAdvisor, uBO; what they
   miss (interaction-level: clickjacking/ClickFix), user complaints (FP/perf/privacy), unowned niche.
4. **Platform constraints & escape hatches:** MV3 limits (no blocking webRequest, DNR limits, SW
   lifecycle, userScripts API, offscreen docs, Side Panel API, world isolation); Firefox's retained
   blocking webRequest; native-messaging companion architectures; browser-fork cost/benefit.
5. **Feedback & local telemetry design:** decision-time snapshot design, labeled-corpus
   construction, active-learning loops, session-replay (rrweb) capture, local personalization.

### Internal (audit) — 13 read-only dimensions
9 subsystems: `scoring-core`, `capture-pipeline`, `main-world-guards`, `credential-guard`,
`sw-state`, `reputation-content`, `visual-js-p4`, `ux-advisor`, `telemetry-feedback`,
`test-harness`; + 4 cross-cutting hunts: `fp-hunter` (trace 9 benign scenarios end-to-end),
`advisor-hunter` (decision-journal gap inventory), `feedback-hunter` (capture-schema design),
`architecture-hunter` (MV3-limit workaround catalogue + escape-hatch ROI). Each finding is
adversarially verified against the code and ranked by product-impact-per-effort.

---

## 4. SEEDED preliminary findings (running start — [VERIFY] = confirm in code)

> These are hypotheses + known facts to accelerate the resumed workflows, organized by vision
> goal. Treat `[VERIFY]` items as **claims to confirm against source**, not established truth.

### Goal 1 — Zero-FP Smart Mode

- **Biggest missing FP lever: a broad top-sites prior.** The repo has `domain_groups.ts`
  (same-org cross-site suppression, fixed the unity3d.com FP) but [VERIFY] **no CrUX/Tranco
  top-1M allowlist/greylist prior.** A site in the global top-100k that trips a heuristic is
  almost always a FP. **Add a build-time-bundled top-sites tier** (fits local-first thesis like
  PSL/bloom already do) and scale the intervention threshold by trust tier. Highest-ROI FP fix.
- **Compounding cross-site/new-tab factors.** [VERIFY] `nrs_cross_site (+20)` + `new-tab (+20)`
  + `redirect_chain_*` can stack on benign flows (OAuth popups, SSO, 3DS, marketing redirectors).
  P2-11 added a ceiling + `openerWindowPreviouslyAllowed (-20)`; confirm it's sufficient for the
  9 `fp-hunter` scenarios (esp. d: mailchimp-style tracking-redirect → cross-site, and a/c: SSO &
  Sign-in-with-Google popups).
- **Trust-tier model proposal:** (1) user-allowlisted → silent; (2) CrUX top + no bad signals →
  silent unless high-confidence interaction attack; (3) seen-before-benign (from local
  `domain_profile`/history) → relaxed; (4) unknown → normal; (5) bloom/known-bad → strict.
  Intervention threshold = f(tier). This is the structural answer to "silent in Smart Mode."
- **Engagement/familiarity suppression:** [VERIFY] does `domain_profile.ts` carry a first-seen /
  visit-count / familiarity signal? If yes, leverage it to suppress on habitual sites; if no,
  it's a cheap high-value add (novelty detection is core to low-FP behavioral security).
- **ClickFix / clipboard FP risk:** legit "copy code" buttons on docs sites write to clipboard.
  [VERIFY] the clipboard-write + overlay correlation requires BOTH signals — confirm a lone
  clipboard write on a benign docs page does not prompt.

### Goal 2 — Friend-advisor UX (verbose mode / decision journal)

- **Building blocks already exist:** `explanations.ts` (reason-code → plain English),
  `event_tone.ts`, `debug_overlay.ts` (dev-facing). **Gap:** [VERIFY] there is no *user-facing*
  decision journal — a reviewable timeline of "what did NavSentinel decide, when, and why,"
  including **silent** decisions (suppressed signals, scores below threshold). The advisor goal
  needs *silent* decisions surfaced on demand, not just the loud prompts.
- **Coverage audit needed:** which reason codes lack a plain-English mapping in
  `explanations.ts`? Every code that can reach a user must have one.
- **Best home for the journal: the Chrome Side Panel API** (`chrome.sidePanel`, Chrome 114+) —
  a persistent advisor panel showing the live decision timeline + "why" per event, without
  modal interruption. This is the single highest-leverage UX add and is MV3-native.
- **Verbose mode design:** a toggle that promotes `debug_overlay`-grade detail (full
  CDS/NRS factor breakdown + plain-English why + "what would have happened") into a
  user-readable per-event card. Warning-science (Angle 2) says interruptive prompts must stay
  RARE; the journal/side-panel is the non-interruptive channel that satisfies "friend advisor"
  without warning fatigue.

### Goal 3 — Live feedback capture

- **Today's telemetry is outcome-only, not replay-grade.** [VERIFY] `promptOutcomes` schema is
  `{domain, type, score, outcome, timestamp}` (P1-08), bounded ~500 entries. This records *that*
  a decision happened and the single aggregate score — but **not the full feature vector** (every
  CDS/NRS factor + value), DOM hints, redirect chain, gesture timing, or page context. That is
  the core telemetry gap: **you cannot re-score or retrain offline from what's captured today.**
- **Proposed capture record** (single type, recorded at every verdict surface — toast
  allow/dismiss, credential modal trust/block/cancel, allowlist add, smart-default accept/reject):
  `{ id, ts, url, title, trustTier, mode, detector, scoreBreakdown:{factor:value...},
  thresholdUsed, domHints, redirectChain, gestureTiming, rawSignals, decision, userVerdict,
  wasWrong?:bool }`. The `scoreBreakdown` + `userVerdict` pair is a labeled training example.
- **Storage:** move from the ~500-entry `chrome.storage.local` ring to **IndexedDB +
  `unlimitedStorage`** for an unbounded single-user corpus; add a JSON/CSV **export** path.
- **The flywheel:** offline, re-tune NRS/CDS weights via logistic regression over the captured
  feature→verdict pairs, then **replay the corpus** to measure FP/TP delta before shipping a
  scoring change. This is the principled upgrade to `adaptive_scoring.ts` (which today
  [VERIFY] shifts per-domain thresholds ±15 from local outcomes).
- **"This was wrong" affordance:** retrofit a one-tap mislabel button onto every intervention
  surface → flips the label in the corpus → feeds active learning. Cheap, single-user-friendly.
- Existing plumbing to EXTEND not rebuild: P1-08 prompt telemetry + P3-05 adaptive scoring
  already write outcomes at the verdict sites — widen the payload there rather than adding a new path.

### Goal 4 — Architecture leverage (escape hatches)

- **Can NavSentinel actually BLOCK, or only react?** [VERIFY] whether `declarativeNetRequest`
  is used at all. Under MV3, DNR is the only way to *prevent* a navigation/request; the bloom
  known-bad list could feed dynamic DNR rules to hard-block known-bad domains instead of only
  scoring after the fact. Likely a real gap and a strong, MV3-native win.
- **On-device AI is now viable & on-thesis.** Chrome's built-in **Prompt API (Gemini Nano)** runs
  locally with zero network calls — a perfect fit for the local-first thesis. Use it (in an
  **offscreen document**, since the SW has no DOM/Gemini access) to classify page text for
  scam/tech-support-scam/credential-phish intent. This is also what Chrome itself now ships in
  Enhanced Safe Browsing (validates the direction; note it as both opportunity and competitor).
- **Visual-sim (P4-01c) is likely on the wrong tech.** The pipeline ships PLACEHOLDER perceptual
  hashes (AI-5 blocks real templates). Research (Phishpedia/PhishLLM) shows **perceptual hashing
  is weak/evadable** for brand impersonation vs **logo CNN/Siamese embeddings** or an **on-device
  VLM**. Decision needed: complete pHash as a weak signal vs pivot to CNN-embedding/Gemini-Nano-
  multimodal brand detection. Lean pivot; keep pHash only as a cheap pre-filter.
- **Firefox build (FF-02, AI-4 pending):** Firefox retains **blocking webRequest** → a FF build
  can do real synchronous request blocking Chrome MV3 cannot. Pairs with the DNR gap above:
  Chrome gets DNR (coarse), Firefox gets true blocking (fine). FF-01 `browser.*` shim already
  merged (#173); FF-02 is blocked on a build-tooling decision (crxjs-experimental vs web-ext vs
  hand-rolled Vite config).
- **Native-messaging companion = the "antivirus-like approach" the user asked about.** A small
  local helper (Go/Rust) via `nativeMessaging` unlocks what no extension can: DNS inspection,
  download scanning, process monitoring, file quarantine, persistent state (no SW death), and
  heavy ML inference. Install friction (native-host manifest registration) is the cost, but for
  a single-user dev machine it's entirely feasible and the **highest-ceiling escape hatch.**
  This is where the project goes from "extension" to "security companion."
- **Browser fork: recommend AGAINST (be sober).** Brave/Vivaldi/Arc show the Chromium-rebase
  treadmill is a full-time team's job. For a solo dev the ROI is negative. The
  extension + native-companion (+ Firefox build for blocking) combination delivers ~all of the
  fork's security value at a tiny fraction of the maintenance cost.
- **Known MV3 workaround fragility to catalogue:** SW-lifecycle state in `chrome.storage.session`
  (rehydration races — see merged #180/#189/#191), MAIN↔ISOLATED bridge auth (open issue **#186**),
  per-frame bloom loading under `all_frames` (P2-13), CSP header blindness (**#179**), SRI partial
  coverage (**#178**). Each is a candidate for "native companion fixes this structurally."

### Cross-cutting: measurement gaps (test-harness)

- [VERIFY] FP measurement (`scripts/measure-fp.mjs`) ran on only ~138 sites (0.72% → fixed). For
  a "zero-FP Smart Mode" claim you need **continuous, larger FP regression** (Tranco/CrUX top-1k+
  with realistic interactions) as a CI gate — a **"Smart-Mode silence" gate**: prompts-per-100-
  benign-pages must stay ≈0.
- Corpus TP was ~28% overall (limited by static-snapshot JS injection). Dynamic-capture corpus or
  live-sandbox replay would give a truer TP number.
- **No measurement exists today for vision goals 2 (advisor quality) or 3 (feedback richness).**
  Add metrics: explanation coverage %, journal completeness, capture-record completeness.

---

## 5. Next-session checklist

1. Re-run the two workflows per §2 (internal-audit first; deep-research second). One at a time.
2. Replace the §4 `[VERIFY]` hypotheses with code-grounded findings from the audit synthesis.
3. From the synthesis, draft a **North-Star roadmap addendum** under `docs/` (new Phase 5 or a
   "North-Star" track): the four programs — FP-Elimination, Friend-Advisor, Feedback-Capture,
   Architecture/Platform — each as ordered, gated slices in the existing P{phase}-{seq} style.
4. Seed concrete GitHub issues for the top priorities (respect the zero-tech-debt contract).
5. Surface open ACTION_ITEMS (AI-3, AI-4, AI-5) — AI-4 (Firefox tooling) and AI-5 (brand
   templates) are direct dependencies of the architecture & visual-sim programs above.

## 6. Open human-owned items relevant here (from ACTION_ITEMS.md)

- **AI-4 (OPEN)** — decide Firefox build tooling (blocks FF-02→03→04 stack; gates the Firefox
  blocking-webRequest escape hatch).
- **AI-5 (OPEN)** — supply sanctioned brand login screenshots (blocks visual-sim P4-01c; relevant
  to the visual-sim tech decision above — may be mooted if we pivot to CNN/VLM).
- **AI-3 (OPEN)** — fate of `fix/jsb-stale-todos-and-tests` (relates to JS-behavior #127).
