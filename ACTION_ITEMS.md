<!-- AGENT CONTRACT: This file tracks tasks that only the human (Chris) can do.
     - Read it at session start (it is in the CLAUDE.md / AGENTS.md First-5-Minutes list).
     - Surface every OPEN / BLOCKED item near the top of any summary, status report, or handoff you give Chris. Never let an open item go unmentioned.
     - Mark an item DONE *only* when Chris explicitly says so (e.g. "AI-1 is done"). Move it to the Completed log with the date and a one-line result. Do not self-clear.
     - Keep the "Current state snapshot" accurate when verified truth changes. This file is the can't-lose-context store while the status docs on `main` are stale (see note). -->

# ACTION ITEMS — Human-Owned Tasks (NavSentinel)

**Purpose:** the running list of things only *you* (Chris) can do — and the context an agent needs to not lose the thread between sessions. Agents flag the open items in every summary; you clear them by saying so.

**Last updated:** 2026-06-13 (session 2) · by Claude — merged **#247** (North-Star docs; 10 bot findings fixed) + **#248** (failure-ledger autolog hook fix) + **#250** (status-doc sync) + a `gym:serve` Vite-8 fix. **#249 OPEN** = P5-C1 / **#238** (replay-grade `PromptOutcomeEntry`): green CI + 2 adversarial review rounds, **2444 unit tests**, all perf budgets pass — **awaiting your Gate-3 manual Chrome test + merge (= AI-6).** `main` @ `1b0a4a9`. AI-3 ✅ · AI-4 ✅ web-ext · **AI-5 open (reference brand logos)** · **AI-6 open (Gate-3 #249)**.

> **Why this file exists separately from the usual docs:** the status docs on `main`
> (`docs/agentic/HANDOFF.md`, `docs/agentic/ORCHESTRATOR.md`, `docs/Project_Roadmap.md`,
> `autodoc/AGENT_INDEX.md`) are currently **stale** and **cannot be edited cleanly** because
> open PRs already carry divergent edits to those same files. Editing them now = merge
> conflicts. They get reconciled in one pass after the PRs merge (tracked in **issue #184**).
> Until then, **this file + the persistent memory are the source of truth for current state.**

---

## Current state snapshot (verified 2026-06-14)

- **(2026-06-14 Codex pickup - P5-A4 update):** New PR **#256** opened for P5-A4 / #235 (`feat/p5a4-container-intent`, latest commit `9bef0a5`). Scope: container-aware `intent_mismatch_under_interactive` suppression for structural navigation containers only when the top container actually contains the underlying action; sibling/full-page/delegated overlays without containment remain blockable. Two independent local adversarial reviews both found the high-severity delegated overlay evasion in the first implementation; fixed before opening PR. Local verification: focused scoring/dom-builder tests (120 pass), `typecheck`, `lint`, `build`, perf budget 12/12 (`capture_isolated` 61.0KB / 62KB; total dist 448.8KB / 500KB), full unit 2433 pass with known happy-dom/network stderr. CI/re-review now running on #256. Human-owned OPEN items remain **AI-5** and **AI-6**.

- **(2026-06-14 Codex pickup - P5-A2 update):** PR **#255** is open for P5-A2 / #233 (`feat/p5a2-signal-smart-gating`, latest commit `4a77b39`). Scope: Smart-Mode blank-anchor prompt suppression for narrow benign contexts with trusted pointer/click or keyboard gating, NRS block/factor safeguards, curated IdP/payment matching including Microsoft Live OAuth authorize endpoints, OAuth monitor tracking parity for Microsoft Live endpoints, and new Gym/E2E regression. Local verification after the latest review fix: focused OAuth/Smart/SW tests (197 pass), `typecheck`, `lint`, `build`, targeted E2E (3 pass), perf budget 12/12 (`capture_isolated` 62.6KB / 63KB), full unit 2443 pass with known happy-dom/network stderr. Two independent local adversarial reviews completed; all findings addressed. Gemini keyboard-activation and Codex OAuth-tracker feedback fixed; CI is green and re-review is running on #255. Human-owned OPEN items remain **AI-5** and **AI-6**.

- **(2026-06-14 Codex pickup - CURRENT):** `main` == **`a68958c`** (`#251` merged the Vite-8 Gym serve fix). Reused canonical orchestrator `docs/agentic/ORCHESTRATOR.md`. Open PRs are **#249** (P5-C1 / #238; green CI + 2 review rounds, waiting on AI-6 manual Chrome Gate-3), **#253** (P5-B1 / #236 silent-decision events; all Gemini/Codex review findings addressed through `42fff89`; local verification: typecheck, lint, build, targeted tests 65 pass, full unit 2464 pass, all 12 perf budgets pass; CI green), **#254** (draft docs/CI PR refreshing `AGENTS.md` against `CLAUDE.md`; Gemini formatting finding fixed in `e0fa07c`; redundant Xvfb apt step removed after hosted runner Microsoft feed 403 broke E2E; `agent:skills:validate` pass; CI rerun pending after latest push), **#255** (P5-A2 / #233 Smart Mode blank-prompt suppression; keyboard, Live OAuth suppressor, and OAuth monitor parity fixes through `4a77b39`; CI green/re-review running), and **#256** (P5-A4 / #235 container intent heuristic; local adversarial findings fixed through `9bef0a5`; CI/re-review running). Human-owned OPEN items remain **AI-5** and **AI-6**.

- **(2026-06-13 session 2 — CURRENT):** `main` == **`1b0a4a9`**. This session merged: **#247** (North-Star roadmap/research docs — fixed all 10 gemini+codex review findings first), **#248** (failure-ledger hygiene: `PostToolUseFailure` → **gitignored `failure_autolog.jsonl`**; curated `failure_ledger.jsonl` scrubbed 78→**7 real entries** [71 were `unclassified` noise]; `agent:hooks:smoke` made branch-aware), and **#250** (status-doc reconciliation). A follow-up PR fixed **`npm run gym:serve`** for Vite 8 (`vite --root gym` → `vite gym`; v8 dropped the `--root` flag, root is now positional — the Gym + Gate-3 testing work again). **#249 OPEN** = P5-C1 / **#238** (replay-grade `PromptOutcomeEntry`: adds `cds`/`nrsFactors`/`navAnomalyScore`/`adaptiveAdj`/`thresholdUsed`/`elementContext`, fixes nav-drops-`reasons` + cred-lacks-`destDomain`): **green CI (Build/Unit + E2E), 2 adversarial review rounds (self-run workflow + Codex) all fixed, 2444 unit tests, all 12 perf budgets pass** — **awaiting Gate-3 manual Chrome test + merge (= AI-6, walkthrough in `POST_MERGE_MANUAL_VERIFICATION.md`).** **Gotcha learned:** `npm run check:perf-budget` is a CI-only gate (not in `test`/`lint`/`typecheck`/`build`); run it locally for any extension change.
- *(2026-06-13 session 1, superseded):* `main` == `da400fb`, working tree clean apart from the North-Star docs (`docs/NORTHSTAR_ROADMAP.md`, `docs/research/`) + status-doc re-hydration. **0 open PRs.** The `fix/jsb-stale-todos-and-tests` branch is gone (AI-3 ✅ resolved). Baseline: typecheck clean, lint 0/0, **2426 unit tests pass**. **48 open issues**, incl. North-Star **#232–#246**.
- *History (2026-06-05, superseded by the header above):* the snapshot below describes the D-series batch at `4bd60ce`; cycles 3–4 (2026-06-06, PRs #197/#202/#208/#210/#212/#214/#220/#230) and the North-Star initiative (2026-06-13) have since landed.
- **ALL 11 D-series discovery PRs MERGED 2026-06-05** (oldest-first, merge commits): **#180, #182, #183, #185, #187, #189, #190, #191, #193, #194, #195.** Each had **fresh-green CI (Build/Unit + E2E)** + **two or more independent adversarial review rounds with ALL findings (every severity) fixed**.
- **Gate 3 (manual Chrome test) was explicitly WAIVED by Chris for this batch** (decision 2026-06-05) and the merges proceeded. The waiver did **not** discard the manual checks — they are **deferred** to a regression watchlist: **`docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md`**. Accepted risk = time/difficulty if debugging is needed, not silent regressions. **Run that checklist next time you build & load the extension** (see AI-1 in the Completed log; the watchlist supersedes it).
- **#182 needed a docs-only conflict resolution** (status files diverged once the other 10 landed). Resolved by taking `main`'s side, then verified locally: **tsc clean, lint 0/0, 2298 unit tests pass**; CI re-ran **green (Build/Unit + E2E)** on the merge head before merge.
- **Docs reconciliation (#184) done in this pass:** `docs/Project_Roadmap.md`, `autodoc/AGENT_INDEX.md`, `docs/agentic/HANDOFF.md`, `docs/agentic/ORCHESTRATOR.md` brought to current truth. The form-submit patch-order bug (fixed in #185) is now recorded in `docs/agentic/failure_ledger.jsonl`.
- **Spring cleaning (2026-06-05):** archived the two stale root orchestration docs → `docs/archive/ORCHESTRATOR.md` + `docs/archive/ORCHESTRATION.md` (the ONE canonical orchestrator is now unambiguously `docs/agentic/ORCHESTRATOR.md`); pruned 60 shell-typo junk entries from `failure_ledger.jsonl` (138→78 lines, every real entry kept, all valid JSON); removed the stale `%TEMP%\ns-review` git worktree; triaged git stashes (13 noise/superseded dropped, **4 `feat/js-behavior-*` WIP kept for JSB-127**). Remote branches + tags were already clean; working tree clean.
- **#192** is closed (findings 1+2→#193, 3→#195, 4→#194). **#196** seeded (DRY the inline-hidden password detection into a shared helper across `sri_checker` + `content_analyzer`).
- **Agent sandbox cannot run a browser or spawn threads** — `npm run test:e2e` / `agent:hooks:smoke` fail with launch/thread errors locally; the same E2E passes on GitHub CI. That is *why* Gate 3 is a human task and why the deferred watchlist exists.
- **Remaining backlog (next, not yet started):** **#196** (small DRY refactor) → **FF-02 → FF-03 → FF-04** (stacked Firefox port; FF-02 = Vite Firefox build config — **needs a tooling decision**: `@crxjs/vite-plugin` Firefox support is experimental; runtime verification is human-gated) → **JSB-127** (inspect local `fix/jsb-stale-todos-and-tests` first — AI-3) → another fresh discovery pass.
- Open issues: #175 #176 #178 #179 #181 (discovery) + #127 (JS behavior) + #184 (housekeeping — substantially done this pass) + **#186** (bridge init-auth: echo-verify/replay-repin/thrash — needs SW-vouched token) + **#188** (options should surface prompt-outcome import/clear failure) + **#196** (shared hidden-password helper).
- **Resolved question:** the "merge systematically" vs. Gate 3 tension is settled — Chris waived Gate 3 for the 2026-06-05 batch and authorized the merges, with manual checks deferred to the watchlist. (For *future* batches, confirm the posture again unless told it's standing.)
- **North-Star initiative (2026-06-13):** the research + audit initiative completed this session (main @ `da400fb`; discovery cycles 3–4 added issues up to #231). Internal audit = **153 verified findings**; **4** deep-research passes done (broad + 2 gap-fill + GAP-D). All artifacts persisted under **`docs/research/NORTHSTAR_*`**, and the program plan is **`docs/NORTHSTAR_ROADMAP.md`** (Phase 5: FP-Elimination / Friend-Advisor / Feedback-Capture / Architecture). **Top unblockers:** signal-level Smart-Mode gating (#233), enrich the capture record (#238), top-sites trust-tier prior (#234). The ~15 new P5 slices are **filed: #232–#246** (`north-star` label) — no go-ahead pending. **No open research gaps remain** (GAP-D done: conformal/rrweb/single-user loop, 24 verified claims, unblocks P5-C5).

---

## Action items

**OPEN: AI-6 — manual Gate-3 on PR #249 (P5-C1 / #238) + merge.** The only open PR; green CI + 2 adversarial review rounds resolved; the only thing left is the real-browser check the sandbox can't run. Walkthrough: `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` → "Pending PRE-merge: #249", and AI-6 below. (`npm run gym:serve` was fixed for Vite 8 this session, so the Gym works again.)

**OPEN: AI-5 — supply/sanction a set of reference brand *logos* for the logo-embedding model** (or confirm using a public logo set, e.g. the Phishpedia reference list). The pHash-vs-logo *tech decision is already made* — the pivot to logo-embedding is confirmed (D24); this is now a small, low-stakes asset-approval task feeding P5-D6 (#246) / P5-D5 (#245), **not** a pending decision and **not** blocking near-term Phase-5 work. AI-1, AI-2 resolved 2026-06-05; **AI-3, AI-4 resolved 2026-06-13** (see Completed log). The deferred manual checks live in `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md`.

> **Note (2026-06-13):** `main` has advanced to `da400fb` since the 2026-06-05 snapshot below (`#196`/FF/domain-impersonation work merged). The snapshot's PR-batch facts are historical; current open-item truth is in this section.

### AI-6 — Manual Gate-3 on PR #249 (P5-C1 / #238) + merge · 🔴 **OPEN (2026-06-13)**

**Why it's yours:** #249 changes what is persisted to `chrome.storage.local` at every nav/cred decision (the replay-grade `PromptOutcomeEntry`: `cds`, `nrsFactors`, `navAnomalyScore`, `adaptiveAdj`, `thresholdUsed`, `elementContext`; plus nav `reasons` and cred `destDomain`). It is **green on CI (Build/Unit + E2E), CLEAN/mergeable, 2 adversarial review rounds resolved** — the only remaining gate is the manual Chrome test the sandbox can't run.

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

### AI-5 — Visual-sim brand assets · ✅ **DECIDED 2026-06-13 — pivot to logo-embedding; re-scoped**

> **DECIDED 2026-06-13 (Chris): pivot to logo-embedding (D24).** The original "sanctioned brand login *screenshots* for pHash" ask is **moot** — perceptual hashing is retired to a cheap pre-filter. **AI-5 re-scopes to:** supply/sanction a set of reference brand **logos** for the Siamese/CNN embedding model (or confirm using a public logo set, e.g. the Phishpedia reference list). This is now a smaller, lower-stakes asset task feeding **P5-D6 (#246)** + the on-device-ML host **P5-D5 (#245)**. Tracked as re-scoped-OPEN (logo set still to be confirmed), not blocking near-term Phase-5 work. Original deferral context retained below.

> **Deferred 2026-06-13 (Chris):** do **not** source screenshots yet. The North-Star research (`docs/research/NORTHSTAR_RESEARCH_HANDOFF.md`, lines 192–196) finds perceptual hashing is weak/evadable for brand impersonation vs **logo CNN / Siamese embeddings** or an **on-device VLM**, and leans toward a pivot (pHash as a cheap pre-filter only). Collecting pHash source screenshots now risks gathering the wrong assets. **Hold AI-5 until the visual-sim tech direction (finish pHash vs. pivot to CNN/VLM) is finalized by the research program;** then this item is either re-scoped (training/reference images) or closed. Stays OPEN as a tracked dependency, not actionable yet.
>
> **DECISION INPUT READY 2026-06-13 (gap-fill research, 3-vote verified):** the visual-sim tech call is now answerable. **Recommend the PIVOT to logo-embedding.** Evidence: USENIX'21 **Phishpedia** (logo + Siamese embeddings) = **98.2% precision / 87.1% recall / 0.19s/page**, far above perceptual-hash/EMD/PhishZoo/LogoSENSE; a pure on-device pHash extension (PhishSnap) is feasible but low-accuracy. Plan: keep pHash only as a cheap pre-filter, pivot confirmation to a logo-embedding model (or on-device VLM in an offscreen doc). See **`docs/NORTHSTAR_ROADMAP.md` → P5-D6 + Decision D24**. **If Chris confirms the pivot, AI-5 re-scopes to "supply reference brand *logos*" (not login screenshots), or P4-01c-as-pHash is closed.** Caveat: Phishpedia is an *identification* system (assumes a page is already flagged) with limited in-the-wild brand coverage — pair it with the existing brand/domain-mismatch flag.


**Why it's yours:** the visual-similarity pipeline is fully built and wired but ships **PLACEHOLDER** template hashes (`scripts/build-brand-templates.mjs` emits seeded-PRNG values), so it can never fire a true positive. Replacing them needs hashes built from **real brand login pages** — sourcing/sanctioning those screenshots is a product/legal call only you can make.

**Context:** P4-01c in `docs/Project_Roadmap.md` + `docs/agentic/ORCHESTRATOR.md` (BLOCKED). Until real templates exist, visual-sim is plumbing-complete, detection-pending.

**Done when:** you supply (or point me to) a sanctioned set of brand login screenshots, or decide to defer P4-01c indefinitely.

---

## Completed log

- **AI-1 — Gate 3 manual Chrome test · WAIVED → DEFERRED · 2026-06-05.** Chris waived the manual-test gate for the 11-PR batch; merges proceeded on fresh-green CI + 2× independent adversarial review. Manual checks preserved as a deferred regression watchlist in `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` (run on next build + load).
- **AI-2 — Merge order + execution · DONE · 2026-06-05.** All 11 D-series PRs merged oldest-first (#180, #182, #183, #185, #187, #189, #190, #191, #193, #194, #195). #182 merged last after a docs-only conflict (resolved by taking `main`; verified tsc clean / lint 0/0 / 2298 unit tests + green CI on the merge head). `main` @ `4bd60ce`, 0 open PRs, branches pruned.
- **AI-3 — Fate of `fix/jsb-stale-todos-and-tests` · RESOLVED (superseded) · 2026-06-13.** Verified on `main` @ `da400fb`: branch gone (local + origin), stale TODO markers gone from `js_behavior_monitor.ts`, and `computeJsBehaviorScore` now a live implemented function (`js_behavior_state.ts:67`). Both branch intents landed via later merges; nothing to do.
- **AI-4 — Firefox build tooling for FF-02 · DECIDED · 2026-06-13.** Chose **(b) `web-ext` + separate `manifest.firefox.json`** over experimental crxjs Firefox (a) and hand-rolled Vite config (c), because FF runtime verification is human-gated and rewards a stable, well-documented toolchain. FF-02 to be implemented against web-ext.
