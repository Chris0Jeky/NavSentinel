<!-- AGENT CONTRACT: This file tracks tasks that only the human (Chris) can do.
     - Read it at session start (it is in the CLAUDE.md / AGENTS.md First-5-Minutes list).
     - Surface every OPEN / BLOCKED item near the top of any summary, status report, or handoff you give Chris. Never let an open item go unmentioned.
     - Mark an item DONE *only* when Chris explicitly says so (e.g. "AI-1 is done"). Move it to the Completed log with the date and a one-line result. Do not self-clear.
     - Keep the "Current state snapshot" accurate when verified truth changes. This file is the can't-lose-context store while status-doc PRs are in flight (see note). -->

# ACTION ITEMS — Human-Owned Tasks (NavSentinel)

**Purpose:** the running list of things only *you* (Chris) can do — and the context an agent needs to not lose the thread between sessions. Agents flag the open items in every summary; you clear them by saying so.

**Last updated:** 2026-07-03 — ship/measure direction adopted + status docs collapsed (#421/#422). This session merged **#429** (claims-honesty #423) + **#430** (release guard #321-companion + fixed an unparseable `release.mjs`). Standing decisions: `docs/agentic/DECISIONS.md`. See the single snapshot below; historical snapshots are archived (link at the end of the snapshot).

> **Why this file exists separately from the usual docs:** it is the durable human-task
> register while status-doc PRs are in flight. `docs/agentic/HANDOFF.md`,
> `docs/agentic/ORCHESTRATOR.md`, `docs/Project_Roadmap.md`, and
> `autodoc/AGENT_INDEX.md` may lag `main` or open PRs between sync commits. Use this
> file plus live GitHub state as the source of truth, and reconcile the status docs when
> verified truth changes.

---

## Current state snapshot (verified 2026-07-03)

`main` @ **`de2d7ce`** (verify: `git rev-parse origin/main` + `gh pr list`). typecheck/lint clean, **2856 unit tests** (94 files), perf 12/12, CI green on `main`.

- **Direction:** ship/measure, **not** hardening — adopted 2026-07-03 (`docs/agentic/DECISIONS.md` D-2026-07-03-A). Follow the **Priority Ladder** in `docs/agentic/ORCHESTRATOR.md`; discovery is milestone-gated; LOW residue -> `docs/agentic/ICEBOX.md`.
- **Open PRs (all human-gated, at the WIP cap of 3 - D-2026-07-03-D):** #399 (AI-14 `measure:fp`), #356 (AI-13 Gate-3), #273 (AI-8 Gate-3). **Do not open more browser-surface PRs until this drains.**
- **Last session (2026-07-03):** merged **#429** (claims-honesty #423 - README/store/roadmap/orientation now match shipped+measured reality: the fake 52-byte bloom, 0 releases, benchmark `lastRun:null`, dead visual-sim, stale test counts) and **#430** (release guard `check-bloom-real.mjs` + **fixed a pre-existing syntax error that made `release.mjs` unparseable** = the literal reason `npm run release` never ran). Then resolved all deferred decisions (D-2026-07-03-A..H) and collapsed the status docs.
- **Cycles 44–46 (2026-07-03, agent, no runtime code):** **#427** hygiene sweep (closed #322/#350/#395/#427, re-bodied #339, parked 16 LOW sub-findings in `docs/agentic/ICEBOX.md`) + **#418** benchmark honest re-scope (#433 merged; #418 re-bodied to the gated Safe-Browsing arm) + a docs checkpoint. Open issues **62→58**. No open-item state changed. ⚠️ Found **#426 corpus triage is #417-gated** (only the 5-01 report is committed — the manifest + raw FN results are gitignored/local-only; the 5-01 number is methodologically invalid per #417).
- **Next agent slices (ungated):** #417 corpus-v2 harness (unit-testable protected-vs-fired core + committed manifest; a real run is Gate-3/CI) -> then #426 -> #374 split -> visual-sim excision (D-2026-07-03-F).
- **Historical snapshots** (pre-2026-07-03, ~28 session bullets) archived to [`docs/archive/ACTION_ITEMS_snapshots.md`](docs/archive/ACTION_ITEMS_snapshots.md).

---

## Action items

**🚨 OPEN: AI-15 — Read the strategic review, then run the release-unblock batch session (60-90 min, one sitting).** A full strategic review (2026-07-02) produced two documents — **`docs/Strategic_Outlook.md`** (what's working + the path) and **`docs/Course_Correction.md`** (what's broken + the sort-out plan) — and seeded issues **#415-#427** (`strategy` label). Its headline finding: the project has never shipped (no release, no CWS submission, 0 external users) while ~100 PRs of internal hardening merged in 3 weeks, and every open PR + the release blocker is waiting on you. **Guide:** (1) read `docs/Course_Correction.md` §1/§2/§6 (~10 min); confirm or amend the direction. (2) In ONE sitting, clear the whole gate queue: **AI-9** (#321 bloom build — needs your network), **AI-8** (#273 chip check), **AI-13** (#356 proto de-harden check), **AI-14** (#399 `measure:fp` run) — step-by-step guides are in each item below; #419 tracks an agent-built runner/checklist to make this one continuous flow — and while the extension is loaded, run the **real-Chrome regression sweep** (refreshed watchlist golden paths + #347-class console checks) covering the ~27 runtime-behavior PRs merged unverified since 2026-06-23. (3) Install the build in your daily browser (dogfooding starts BEFORE any CWS submission), then say go/no-go on the **v0.5.0 release train (#415)**. Clearing this one item un-gates more value than weeks of further autonomous hardening. Then tell me "AI-15 done" (or which parts).

**🆕 OPEN: AI-16 — Ratify or amend the 2026-07-03 standing decisions.** On your "call the shots" delegation I resolved the deferred decisions and enacted the #421/#422 policy changes in **`docs/agentic/DECISIONS.md`** (D-2026-07-03-A..H: ship/measure direction, priority ladder + icebox, status-doc collapse, browser-surface re-tiering + WIP cap, headed-lane/Q5, visual-sim excise, distribution sequence). Most are low-stakes + reversible and the loop already follows them, but two want your explicit nod: **D-E** — making a headed lane the primary Gate-3 *reduces* manual oversight, and both strategic docs reserved this Q5 revision for your explicit call, so it is a **recommendation only** until you confirm; and the direction adoption itself. **Guide:** skim `DECISIONS.md` (~5 min); reply "ratify decisions" (or name which to amend/veto). This is your veto checkpoint — nothing blocks on it.

**🚨 OPEN: AI-9 — Build & ship the REAL reputation filter before any real-user release (#321, release blocker).** Discovery pass 3 (2026-06-20) confirmed the shipped `extension/public/reputation_data.bin` is **52 bytes (m=288 bits) = the 15-domain TEST filter**, not real threat intel. CI only runs `build:bloom:test`; `release.mjs`/`package.mjs` have **no bloom-build step**. So `reputationReady()` returns true but `isKnownBadDomain()` only matches 15 `.example` names — **reputation-based detection (+50 known-bad NRS factor) is effectively disabled in production.** Likely intentional for the current pre-release phase, but **must be fixed before shipping to real users.** This needs you because building the real filter requires **network access to URLhaus/OpenPhish** (the local-first sandbox can't/shouldn't fetch external feeds) plus a feed-source + refresh-cadence decision. **Guide:** decide feeds/cadence → `npm run build:bloom` (real builder, needs network) → commit the resulting `reputation_data.bin` (or add a release step that builds it) → verify `m` is in the millions, not 288. Companion code hardening is now **shipped** (was seeded as **#322**, CLOSED 2026-07-03): `build-bloom-filter.mjs` fails closed on the test-domain fallback (#330), and the release path refuses to ship a placeholder — `check-bloom-real.mjs` asserts the packaged `.bin` has a real-filter `m` floor, wired into `release.mjs` + tag-CI (#430). So the **only remaining AI-9 work is the network-gated real-filter build itself**: decide feeds/cadence → `npm run build:bloom` (real builder, needs network) → commit the resulting `reputation_data.bin` (or add the build to the release step) → verify `m` is in the millions, not 288. Then tell me "AI-9 done".

**OPEN: AI-8 — Gate-3 visual check + merge PR #273 (#217 neutral chip).** The one browser-surface PR from session 2: it recolours the popup `nrs_user_activation_active` signal chip from green to a NEUTRAL grey (you chose option (b) — it carries +5 NRS, so green was wrong; grey avoids both a false reassurance and crying wolf on every clicked nav). 2 clean adversarial rounds + green CI; presentation-only (no scoring change). Per the standing posture (browser-surface PRs hold for Gate-3) it was NOT auto-merged. **Guide:** `git fetch && git checkout fix/user-activation-neutral-chip && npm run build`; load `extension/dist` in Chrome; open the popup on a page with a recent clicked navigation; confirm the "active user gesture" signal chip renders **grey** (distinct from green/orange) and looks acceptable. Then `gh pr merge 273 --merge --delete-branch`, or tell me "merge #273" / "AI-8 done". (Review seeded **#274** — chip text-contrast, design-system-wide.)

**AI-10 — Gate-3 + merge the SPA-breakage fix (#352) · ✅ RESOLVED 2026-06-23.** Chris ran the manual Chrome check ("manual checks on chrome for #352 done, it seems to be working fine now") → **#352 merged into `main`** (`#347` pushState de-harden + `#348` reputation WAR). The claude.ai grey screen / infinite-load and the per-page `reputation_data.bin`/`pushState` console errors are fixed; top-frame reputation is re-enabled.

**AI-11 — Toast count-pill (#351 → PR #353) · ✅ RESOLVED 2026-06-23 — MERGED.** Chris said "merge #353"; green CI (incl. the RW-19 e2e fix to accept the coalesced pill) → **#353 merged into `main`** (`d0e0412`). Repeated blocked-popup/redirect prompts now coalesce into one count pill after 3-in-8s (expandable to the latest prompt's Allow once / Always allow). The pill is live on the next `git checkout main && npm run build`.

**🚨 OPEN: AI-13 — Gate-3 verify + merge the enforcement-proto de-harden (#349 → PR #356).** Completes the breakage-class fix: `form.submit`/`requestSubmit`, `location.assign`/`replace`, `window.open` (proto + instance) are now writable+configurable, so legit pages/libraries that wrap them no longer throw. Also revives `js_behavior`'s dead programmatic-submit detection (stacks cleanly, no double-fire). Browser-surface (MAIN-world patching). **Guide:** `git fetch && git checkout feat/dehard-enforcement-protos && npm run build`; load in Chrome. (1) On an analytics-heavy site (one that wraps `window.open`/`form.submit`) confirm **no** console `Cannot assign to read only property` and the page works. (2) Confirm gating is intact: a blocked popup/redirect/form still prompts; the `gym/proto-wrap-05.html` fixture shows all wraps "ok". (3) Confirm the new e2e is green on CI. Then `gh pr merge 356 --merge --delete-branch`, or "AI-13 done".

**🚨 OPEN: AI-14 — `measure:fp` + merge the OAuth coupon-FP fix (#223 → held draft PR #399).** The directed Q1 "implement + HOLD for `measure:fp`" OAuth work. The redirect-mismatch now fires only when the OAuth response is **corroborated** — a query/fragment `code`/`error` co-occurs with a `state` echo, or the fragment carries an access/id token (`hasCorroboratedOAuthResponse`). This kills the false mismatch on a benign cross-domain page carrying a generic `?code=` coupon during an active flow, while still catching real attack callbacks (which echo `state`; query, implicit-fragment, and OIDC `response_mode=fragment` forms are all covered). **Why it's yours:** there is a deliberate, measured **FP↔FN tradeoff** — a flow whose callback omits `state` *entirely* loses redirect-mismatch coverage (`state` is recommended-but-optional). The sandbox can't run `measure:fp` (needs headed Chromium + live Tranco). It is opened as a **draft** so it cannot auto-merge. A 1-round self-review (Workflow) caught + got fixed a `response_mode=fragment` regression; CI green; 2820 unit tests. **Guide:** `git fetch && git checkout fix/oauth-require-state-corroboration-223 && npm run build`; run `npm run measure:fp` (and the OAuth corpus) to confirm the FP reduction outweighs the residual state-less FN. If good: mark the PR ready + `gh pr merge 399 --merge --delete-branch`, or tell me "AI-14 done / merge #399". If the FN is unacceptable, tell me and I'll switch to a narrower variant.

**AI-12 — Top-site FP relief + D1 (#350 → PR #354) · ✅ RESOLVED 2026-06-23 — MERGED.** Chris manually confirmed the relief works on LinkedIn ("tested it on linkedin and it seemed to work fine now") = his measure/Gate-3 in lieu of the full `measure:fp` run (which needs headed Chromium + live Tranco, sandbox-can't). **#354 merged into `main`** (`c4426cf`): `getTierAdjustedBlockThreshold` now relieves TOP_SITE + CDS-only (benign-structural whitelist) by `NRS_TOP_SITE_CDS_RELIEF`; trust list grew 24→42 with safe `includeSubdomains`. Green CI (Build/Unit + E2E) on the main-merged head. **⚠️ Follow-up (not blocking): `+20` is a starting value — if FPs persist on any top-site, bump `NRS_TOP_SITE_CDS_RELIEF` in `nrs.ts`; a full `measure:fp` corpus run is still worthwhile for rigor when convenient.**

AI-1, AI-2 resolved 2026-06-05; AI-3, AI-4 resolved 2026-06-13; **AI-5 resolved 2026-06-19** (Phishpedia public logo set approved); **AI-6 resolved 2026-06-19** (#249 merged after Gate-3 waiver). See Completed log. Deferred manual checks remain on the regression watchlist `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` (run on next build + load; now also covers #249 enriched-capture, #263 credential-submit, and #265 SW-hydration behavior). Standing posture (confirmed 2026-06-19): the agent **may autonomously merge non-browser PRs** (logic/test/build/docs) once aged + 2 adversarial rounds + green CI; **browser-surface PRs still hold for Gate-3**.

> **Note (2026-06-13):** `main` has advanced to `da400fb` since the 2026-06-05 snapshot below (`#196`/FF/domain-impersonation work merged). The snapshot's PR-batch facts are historical; current open-item truth is in this section.

### AI-6 — Manual Gate-3 on PR #249 (P5-C1 / #238) + merge · ✅ **RESOLVED 2026-06-19 — Gate-3 WAIVED by Chris; #249 merged**

> Closed 2026-06-19 (Chris waived Gate-3 for the #249/#263/#265 batch and authorized the agent merge). **#249 merged into `main`** (replay-grade `PromptOutcomeEntry`) on green CI + 2 adversarial review rounds. The manual-browser check is preserved on the deferred regression watchlist `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` (run on next build + load). Original guide retained below for reference.

**Why it was yours:** #249 changes what is persisted to `chrome.storage.local` at every nav/cred decision (the replay-grade `PromptOutcomeEntry`: `cds`, `nrsFactors`, `navAnomalyScore`, `adaptiveAdj`, `thresholdUsed`, `elementContext`; plus nav `reasons` and cred `destDomain`). It is **green on CI (Build/Unit + E2E), CLEAN/mergeable, 2 adversarial review rounds resolved** — the only remaining gate is the manual Chrome test the sandbox can't run.

**Guide** (full version in `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` → "Pending PRE-merge: #249"):
1. `git fetch && git checkout feat/p5c1-enrich-prompt-outcome && npm run build`
2. Load `extension/dist` unpacked in Chrome; second terminal `npm run gym:serve` (fixed for Vite 8 — serves `http://localhost:5173`).
3. Trigger a blocked/prompted **nav** (suspicious blank-anchor / new-tab fixture) and a **credential** prompt (`level11-credential-guard.html`); make varied choices (allow/block/trust/cancel).
4. Options page → **Export**; confirm the newest records carry the enriched fields — nav: `cds`/`nrsFactors`/`thresholdUsed`/`elementContext`/`reasons` (+`destDomain` on blocks); cred: `reasons`+`destDomain` (action host). Confirm `elementContext` has only structural fields (no text/URLs). No SW/page console errors.
5. **Done when:** verified → `gh pr merge 249 --merge --delete-branch`, or tell me "AI-6 done / merge #249" (or "waive Gate-3" as on 2026-06-05) and I'll merge.

---

### AI-1 — Manual Chrome test (Gate 3) · ✅ **RESOLVED 2026-06-05 — Gate 3 WAIVED by Chris; manual checks deferred to the watchlist**

> Closed: the 11 PRs merged 2026-06-05 after Chris waived the manual-test gate (green CI + 2× adversarial review). The step-by-step guide below is retained for reference only; the live deferred-check list is **`docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md`** — run it next time you build and load the extension.

**Why it's yours:** the contract requires manual testing in a real Chrome (PR Merge Protocol Gate 3), and the agent sandbox can't launch a browser. Everything else for these PRs is already green.

**Guide:**

1. **Check out and build each PR branch** (one at a time):
   ```sh
   git fetch origin
   git checkout fix/credential-modal-focus-trap   # #183 (D-FOCUS) — start here, it's the most browser-visible
   npm ci        # if deps changed; otherwise npm install
   npm run build # outputs to extension/dist
   ```
2. **Load the extension:** open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select the `extension/dist` folder.
3. **Serve the test pages:** in a second terminal, `npm run gym:serve` (serves the `gym/` fixtures at `http://localhost:5173`).
4. **#183 D-FOCUS — focus-trap golden path + edge cases:**
   - Open `http://localhost:5173/level11-credential-guard.html`, type a password, click **Submit**. The **"Credential submit blocked"** modal must appear.
   - With the modal open, verify focus containment (the fix): **Tab**/**Shift+Tab** cycles only among the modal buttons; clicking the page behind snaps focus back; `document.querySelector('#submitBtn').focus()` in the console bounces focus back into the modal; **Esc**/cancel still dismisses and returns focus sensibly.
5. **#182 D-STORE — prompt outcomes persist:** trigger several credential prompts and choose actions (trust/block) rapidly across reloads; confirm choices persist and the popup/options reflect them (no lost outcomes). Multiple tabs/frames at once is the stress case.
6. **#180 D-PROF — no console errors under repeated navigation:** browse risky/benign fixtures repeatedly; confirm no domain-profile errors in the SW console and risk state stays consistent.
7. **#185 D-BRIDGE + #187 D-SWRATE — regression smoke (internals):** browse a mix of gym fixtures (nav blocks, dblclick, clipboard/ClickFix, pushstate); confirm the guard fires normally and there are **no SW or page console errors** (esp. no "Cannot assign to read only property 'submit'" — that was the bug fixed in `9da8bcc`).
8. **#189 D-ANOM — anomaly scoring sane:** with a built-up history, browse a burst to a *rare* category (e.g. several crypto/wallet fixtures) → anomaly contributes to risk; a burst to a *frequent* category → no false elevation. No SW console errors.
9. **#190 D-IFRAME — iframe flags without false positives:** on a benign page, confirm legit iframes (recaptcha/analytics) are **not** flagged and the page works; if you can, inject a `data:`/`srcdoc` iframe via the console (`document.body.appendChild(Object.assign(document.createElement('iframe'),{srcdoc:'<form><input type=password></form>'}))`) and confirm it registers a suspicious-iframe signal. No console errors.
10. **#191 D-ONCREATE — DoubleClickjacking still works (internals):** with it loaded, exercise the dblclick gym fixtures (a page that opens a child window which then navigates the opener) and confirm the dblclick alert still fires; no SW console errors. The fix is about child-window tracking surviving an SW restart, so the smoke check is "dblclick protection still works + no errors."
11. **#193 D-REDOS — content fingerprinting unchanged (internals):** browse phishing-kit gym fixtures (hidden exfil form/iframe pages) and confirm the content-analysis kit detection still fires as before; no page/SW console errors. This is a regex-internals hardening with zero intended detection change, so the check is "still detects + no errors."
12. **Record the result on each PR:** `gh pr comment <#> --body "Gate 3 manual Chrome test: PASS — <notes>"` (or FAIL with what broke). Then tell me "AI-1 done for #NNN" and I'll proceed to merge per AI-2.

**Done when:** you've manually verified all eleven and recorded PASS (or sent fixes back). Tell me which passed.

---

### AI-2 — Merge order decision + execution · ✅ **DONE 2026-06-05**

> Executed: all 11 merged oldest-first (#180 → … → #195; #182 merged last after a docs-only conflict resolution). `main` @ `4bd60ce`, independently verified (0 open PRs). Original guide retained below for reference.

**Why it's yours:** merging is an irreversible product action; the contract leaves the go/no-go and order to you.

**Guide:** once AI-1 passes, tell me the order (recommended: oldest-first **#180 → #182 → #183 → #185 → #187 → #189 → #190 → #191 → #193 → #194 → #195**). I will, per PR: confirm gates, merge, verify `main` afterward by SHA, then move to the next. Note all 7 branch off a slightly older `main`, so each should `git merge main` (not rebase) before merge if conflicts appear. After the last merge I run the post-merge docs reconciliation (issue #184) and add the `failure_ledger.jsonl` entry for the form-submit patch-order bug.

**Done when:** the verified PRs are merged and `main` is confirmed.

---

### AI-3 — Decide the fate of `fix/jsb-stale-todos-and-tests` · ✅ **RESOLVED 2026-06-13 — superseded by merged work; closed**

> Closed 2026-06-13 (Chris: "mark done"). Verified on `main` @ `da400fb`: the branch no longer exists locally or on `origin` (it was deleted after the 2026-06-05 snapshot); the `TODO: Implement (Slice N)` markers are gone from `js_behavior_monitor.ts`; and `computeJsBehaviorScore` is **no longer a dead stub** — it's a live, implemented function in `extension/src/shared/js_behavior_state.ts:67`, called from `capture_isolated.ts`. Both intents of the branch landed organically through later merges. No action remained. Original context retained below.

**Why it was yours:** it was an old local branch with one trivial commit; deleting vs. reviving was a judgment call.

**Context:** branch was one commit `435597c` (2026-05-23) that removed stale "TODO: Implement (Slice N)" markers + a then-dead `computeJsBehaviorScore` stub. Branched off a *2026-05-23* `main`, far behind — would have reverted ~18.8k lines if merged as-is.

---

### AI-4 — Decide Firefox build tooling for FF-02 · ✅ **DECIDED 2026-06-13 — option (b) `web-ext` + `manifest.firefox.json`**

> Decided 2026-06-13 (Chris). **Chosen: (b) `web-ext` + a separate `manifest.firefox.json` and build script.** Rationale: runtime verification is human-gated (sandbox can't drive Firefox), which punishes experimental tooling — so the battle-tested Mozilla toolchain with a clean lint/build signal beats the experimental crxjs Firefox target (a) and the higher-maintenance hand-rolled Vite config (c). Also feeds the North-Star "Architecture" program (FF `blocking webRequest` escape hatch), arguing for the stable option. FF-02 should now be implemented against web-ext.

**Why it was yours:** a tooling/architecture choice with trade-offs that shapes the whole Firefox port.

**Context:** FF-01 (`browser.*` shim) merged (#173). FF-02 needs a Vite Firefox build; `@crxjs/vite-plugin` (v2.4.0) Firefox support is experimental. Options considered: (a) crxjs Firefox target; **(b) `web-ext` + separate `manifest.firefox.json` — CHOSEN**; (c) hand-rolled second Vite config + dual build scripts.

**Next:** implement FF-02 against web-ext, then FF-03/FF-04 stack on top.

---

### AI-5 — Visual-sim brand assets · ✅ **RESOLVED 2026-06-19 — public Phishpedia logo set approved**

> **RESOLVED 2026-06-19 (Chris):** use the **public Phishpedia reference logo set** for the logo-embedding model (P5-D6 / #246, on-device-ML host P5-D5 / #245). The asset-approval question is settled — no further human input needed; implementation may proceed against the Phishpedia reference list. Decision history (the 2026-06-13 pivot) retained below.

> **DECIDED 2026-06-13 (Chris): pivot to logo-embedding (D24).** The original "sanctioned brand login *screenshots* for pHash" ask is **moot** — perceptual hashing is retired to a cheap pre-filter. **AI-5 re-scopes to:** supply/sanction a set of reference brand **logos** for the Siamese/CNN embedding model (or confirm using a public logo set, e.g. the Phishpedia reference list). This is now a smaller, lower-stakes asset task feeding **P5-D6 (#246)** + the on-device-ML host **P5-D5 (#245)**. Tracked as re-scoped-OPEN (logo set still to be confirmed), not blocking near-term Phase-5 work. Original deferral context retained below.

> **Deferred 2026-06-13 (Chris):** do **not** source screenshots yet. The North-Star research (`docs/research/NORTHSTAR_RESEARCH_HANDOFF.md`, lines 192–196) finds perceptual hashing is weak/evadable for brand impersonation vs **logo CNN / Siamese embeddings** or an **on-device VLM**, and leans toward a pivot (pHash as a cheap pre-filter only). Collecting pHash source screenshots now risks gathering the wrong assets. **Hold AI-5 until the visual-sim tech direction (finish pHash vs. pivot to CNN/VLM) is finalized by the research program;** then this item is either re-scoped (training/reference images) or closed. Stays OPEN as a tracked dependency, not actionable yet.
>
> **DECISION INPUT READY 2026-06-13 (gap-fill research, 3-vote verified):** the visual-sim tech call is now answerable. **Recommend the PIVOT to logo-embedding.** Evidence: USENIX'21 **Phishpedia** (logo + Siamese embeddings) = **98.2% precision / 87.1% recall / 0.19s/page**, far above perceptual-hash/EMD/PhishZoo/LogoSENSE; a pure on-device pHash extension (PhishSnap) is feasible but low-accuracy. Plan: keep pHash only as a cheap pre-filter, pivot confirmation to a logo-embedding model (or on-device VLM in an offscreen doc). See **`docs/NORTHSTAR_ROADMAP.md` → P5-D6 + Decision D24**. **If Chris confirms the pivot, AI-5 re-scopes to "supply reference brand *logos*" (not login screenshots), or P4-01c-as-pHash is closed.** Caveat: Phishpedia is an *identification* system (assumes a page is already flagged) with limited in-the-wild brand coverage — pair it with the existing brand/domain-mismatch flag.


**Why it's yours:** the old pHash/template path is no longer the plan. The remaining human decision is which reference brand **logos** the logo-embedding model may use, or whether to use a public reference set such as Phishpedia. That asset approval is a product/legal call only you can make.

**Context:** P5-D6 (#246) carries the logo-embedding implementation path, with P5-D5 (#245) as the on-device ML host. The legacy pHash screenshots/templates context above is retained only as decision history.

**Done when:** you supply or approve a sanctioned set of brand logos, confirm a public logo reference set, or explicitly defer the logo-embedding asset dependency.

---

## Completed log

- **AI-12 — Top-site FP relief + D1 (#354) · DONE · 2026-06-23.** Chris manually confirmed the relief works on LinkedIn ("seemed to work fine now") = his measure/Gate-3 (the full `measure:fp` needs headed Chromium + live Tranco, which the sandbox can't run). **#354 merged into `main`** (`c4426cf`) on green CI (Build/Unit + E2E, including the main-merge head): `nrs.ts getTierAdjustedBlockThreshold` now relieves TOP_SITE + CDS-only (benign-structural whitelist) by `NRS_TOP_SITE_CDS_RELIEF` (+20, tunable); top-site trust list grew 24→42 with safe `includeSubdomains`. This is the lever #234/P5-A3 promised but never shipped.
- **AI-11 — Toast count-pill (#353) · DONE · 2026-06-23.** Chris approved the merge; **#353 merged into `main`** (`d0e0412`). Repeated blocked-popup/redirect prompts coalesce into one count pill after 3-in-8s (expandable to the latest prompt's Allow once / Always allow). Included an e2e fix (RW-19 now accepts the coalesced pill while keeping the no-popup-opened security assertion). Green CI (Build/Unit + E2E).
- **AI-10 — Gate-3 + merge the SPA-breakage fix · DONE · 2026-06-23.** Chris manually verified #352 in Chrome ("working fine now"); **#352 merged into `main`** (`#347` History.pushState/replaceState de-hardened to writable via `softPatchProto` — fixes the claude.ai grey screen; `#348` `reputation_data.bin` added to `web_accessible_resources` — fixes the per-page console error + re-enables top-frame reputation). Green CI (Build/Unit + E2E). Remaining session PRs: **#353** (toast pill, AI-11) and **#354** (top-site FP relief + D1, AI-12, gated on `measure:fp`).
- **AI-1 — Gate 3 manual Chrome test · WAIVED → DEFERRED · 2026-06-05.** Chris waived the manual-test gate for the 11-PR batch; merges proceeded on fresh-green CI + 2× independent adversarial review. Manual checks preserved as a deferred regression watchlist in `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` (run on next build + load).
- **AI-2 — Merge order + execution · DONE · 2026-06-05.** All 11 D-series PRs merged oldest-first (#180, #182, #183, #185, #187, #189, #190, #191, #193, #194, #195). #182 merged last after a docs-only conflict (resolved by taking `main`; verified tsc clean / lint 0/0 / 2298 unit tests + green CI on the merge head). `main` @ `4bd60ce`, 0 open PRs, branches pruned.
- **AI-3 — Fate of `fix/jsb-stale-todos-and-tests` · RESOLVED (superseded) · 2026-06-13.** Verified on `main` @ `da400fb`: branch gone (local + origin), stale TODO markers gone from `js_behavior_monitor.ts`, and `computeJsBehaviorScore` now a live implemented function (`js_behavior_state.ts:67`). Both branch intents landed via later merges; nothing to do.
- **AI-4 — Firefox build tooling for FF-02 · DECIDED · 2026-06-13.** Chose **(b) `web-ext` + separate `manifest.firefox.json`** over experimental crxjs Firefox (a) and hand-rolled Vite config (c), because FF runtime verification is human-gated and rewards a stable, well-documented toolchain. FF-02 to be implemented against web-ext.
- **AI-5 — Visual-sim brand assets · RESOLVED · 2026-06-19.** Chris approved the **public Phishpedia reference logo set** for the logo-embedding model (P5-D6 / #246; host P5-D5 / #245). Asset-approval settled; implementation may proceed. (Path history: 2026-06-13 pivot from pHash screenshots → logo-embedding per D24.)
- **AI-6 — Manual Gate-3 on PR #249 + merge · RESOLVED (Gate-3 WAIVED) · 2026-06-19.** Chris waived Gate-3 for the #249/#263/#265 batch and authorized the agent merge. **#249 merged** (replay-grade `PromptOutcomeEntry`) on green CI + 2 adversarial review rounds. Manual-browser check preserved on the deferred watchlist `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md`. Standing posture confirmed: agent may autonomously merge non-browser PRs; browser-surface PRs still hold for Gate-3.
