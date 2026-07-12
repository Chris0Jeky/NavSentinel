<!-- AGENT CONTRACT: This file tracks tasks that only the human (Chris) can do.
     - Read it at session start (it is in the CLAUDE.md / AGENTS.md First-5-Minutes list).
     - Surface every OPEN / BLOCKED item near the top of any summary, status report, or handoff you give Chris. Never let an open item go unmentioned.
     - Mark an item DONE *only* when Chris explicitly says so (e.g. "AI-1 is done"). Move it to the Completed log with the date and a one-line result. Do not self-clear.
     - Keep the "Current state snapshot" accurate when verified truth changes. This file is the can't-lose-context store while status-doc PRs are in flight (see note). -->

# ACTION ITEMS — Human-Owned Tasks (NavSentinel)

**Purpose:** the running list of things only *you* (Chris) can do — and the context an agent needs to not lose the thread between sessions. Agents flag the open items in every summary; you clear them by saying so.

**Last updated:** 2026-07-10 — full product/architecture/market posture
review. Product thesis: `docs/Product_Strategy.md`. Corrective program:
`docs/Project_Roadmap.md`. Standing decisions: `docs/agentic/DECISIONS.md`.

> **Why this file exists separately from the usual docs:** it is the durable human-task
> register while status-doc PRs are in flight. `docs/agentic/HANDOFF.md`,
> `docs/agentic/ORCHESTRATOR.md`, `docs/Project_Roadmap.md`, and
> `autodoc/AGENT_INDEX.md` may lag `main` or open PRs between sync commits. Use this
> file plus live GitHub state as the source of truth, and reconcile the status docs when
> verified truth changes.

---

## Current state snapshot (verified 2026-07-10)

At the 2026-07-10 verification point, `main` matched `origin/main`. Run
`git rev-parse main`, `git rev-parse origin/main`, and live `gh` checks before
acting; the exact audit baseline lives in `docs/Product_Strategy.md`, not this
live snapshot. Typecheck, lint, build, version check, 2,874 unit tests (95
files), perf 12/12, and smoke E2E passed locally; current-main GitHub CI was
green. v0.4.0 had no tag, GitHub release, CWS release, or external-user evidence.

- **Product posture:** strong pre-release alpha, not a market-ready or
  efficacy-validated security product. `docs/Product_Strategy.md` owns the
  current thesis, beta profile, and evidence gates; `docs/Project_Roadmap.md`
  owns the corrective action register.
- **Release-integrity blockers:** page-controlled injected UI currently owns
  allow/trust/resume authority and can be redressed under genuine input
  (RI-01); visual-sim can process the wrong active
  tab and has no production value (RI-02/#424); frozen MAIN-world prototypes in
  #356 are site-breaking; fake DNR and unmeasured JS behavior should be absent
  or off; stored URLs require minimization (RI-05/RI-06).
- **Release/profile blockers:** the 52-byte reputation test filter plus the
  current ~474/500KB package makes the old "150KB/100K domains" plan
  impossible as written. AI-9/AI-16 must choose the recommended interaction-
  only beta or a fully specified real-filter profile.
- **Brand blocker:** the exact name `NavSentinel` is already used by an active
  GNSS security product. AI-19 requires clearance or an early rename before
  CWS submission; this is a risk flag, not a legal conclusion.
- **Open PRs at WIP cap 3:** #273 is 255 commits behind `main`; #356 is 159
  commits behind and E2E red; #399 is a draft 70 commits behind. **Do not spend
  human Gate-3 time until an agent refreshes/fixes/re-reviews them.** #399 is
  not a beta blocker; #273 may be recreated or deferred; #356 is a prerequisite.
- **Portfolio:** 74 open issues, none assigned or milestoned; #439–#453 are 15
  frozen Horizon proposals. No new feature/epic issue seeding until the queue is
  culled and milestone-categorized.
- **Infrastructure:** branch protection remains absent (`404 Branch not
  protected`). AI-17 remains open. Codex hook trust remains AI-18.
- **Historical snapshots** (pre-2026-07-03, ~28 session bullets) archived to [`docs/archive/ACTION_ITEMS_snapshots.md`](docs/archive/ACTION_ITEMS_snapshots.md).

---

## Action items

> **Gate-queue hold (2026-07-10):** do not run the old branch checkout guides
> for AI-8, AI-13, or AI-14. Their branches must first be refreshed from current
> `main`, re-reviewed twice, and rerun through CI; #356 is currently red. AI-15
> remains BLOCKED until an agent posts a current preflight handoff.

**🚨 OPEN: AI-19 — Clear or replace the working product name before CWS
submission.** An active TruNav GNSS anti-spoofing product uses the exact name
`NavSentinel` and was publicized by the US Department of Transportation in May
2026. This is not a legal conclusion, but shipping under the name without a
search/domain/CWS/trademark review creates avoidable brand and discovery risk.
**Guide:** (1) search UK/US and intended-market trademark databases and company/
product usage; (2) check practical domain, GitHub, social, and CWS availability;
(3) obtain professional advice if a public/commercial launch is intended; (4)
record **keep** or **rename**. If renaming, do it before screenshots, CWS
submission, and external beta invitations. Then tell me "AI-19 done" with the
decision.

**OPEN: AI-18 — Review and trust the new Codex project hooks.** The Codex parity
setup adds `.codex/hooks.json` for session orientation, the shared irreversible
command floor, agentic-change verification reminders, and sanitized failure
capture. Codex deliberately skips new or changed non-managed hooks until their
exact definitions are trusted. **Guide:** start a new Codex session in this
repository, run `/hooks`, inspect the project-local entries from
`.codex/hooks.json`, and choose **Trust** if they match the committed file. Run
`/hooks` again after future hook edits because trust is hash-based. Then tell me
"AI-18 done".

**🚨 BLOCKED: AI-15 — Run the headed release session only after agent
preflight.** The prior 60–90 minute one-sitting guide is withdrawn: all three
PRs are heavily stale, #356 is red, the reputation/package plan needs a product
decision, and new release-integrity blockers precede manual testing. #399 is
stale but remains deferred measurement work, not a beta prerequisite. **Do not
checkout or test the current PR branches yet.** Agent preflight must first:
(1) fix RI-01; (2) refresh/fix #356 and recreate or defer #273, with two fresh
reviews and green CI; (3) excise visual-sim and remove fake DNR; (4) complete
RI-06's purpose-specific data minimization/reset; (5) complete RI-07's explicit
JS-behavior beta-off profile; (6) prepare the chosen AI-9 release profile; and
(7) provide one current headed checklist. Then split human work into a browser
session, any network/feed session, an overnight measurement run, and a short
result review. Read `docs/Product_Strategy.md` first. This item becomes
actionable only when the preflight handoff explicitly says so.

**🆕 OPEN: AI-16 — Ratify or amend the standing product/process decisions.**
The 2026-07-10 posture review extends the July 3 direction: narrow unlisted beta,
interaction-only by default unless real reputation is fully specified, release
integrity before human Gate-3, frozen Horizon/North-Star work, evidence before
claims, and one post-beta visible bet. **Guide:** read the verdict, Beta Product
Profile, and Portfolio sections of `docs/Product_Strategy.md`, then skim
`docs/agentic/DECISIONS.md`. Reply "ratify decisions" or name any amendment.
AI-9's release-profile choice and AI-19's name choice still require explicit
answers; the reversible prioritization is already the working posture.

**🆕 OPEN: AI-17 — Enable GitHub branch protection on `main` (the harness wall).** The 2026-07-06 harness migration to the estate T2 blueprint found `main` has **no server-side branch protection** (`gh api repos/Chris0Jeky/NavSentinel/branches/main/protection` → 404). The local Claude deny floor blocks bare force-push, but it is a *tripwire*, not a *wall*: Codex and any non-hooked client bypass it, and `--force-with-lease origin main` is allowed at T2. The real wall is GitHub branch protection. **Guide:** GitHub → repo Settings → Branches → Add branch protection rule for `main`: (1) **Require status checks to pass before merging** → select `Build / Unit` and `E2E`; (2) optionally **Require a pull request before merging** (matches the current workflow); (3) enable **Do not allow force pushes** and **Do not allow deletions**. (CLI equivalent: `gh api -X PUT repos/Chris0Jeky/NavSentinel/branches/main/protection -f ...`.) Until it is on, agents must never force-push `main` — that is convention only. Then tell me "AI-17 done".

**🚨 OPEN: AI-9 — Choose the beta reputation profile (#321).** The current
asset is a 52-byte test fixture. The old instruction to simply run
`npm run build:bloom` is unsafe: the package is already ~474/500KB, a 150KB
filter cannot meet the stated 0.01%/100K-domain combination, and feed licensing,
provenance, cadence, cardinality, and rollback are unresolved. **Recommended
choice:** ship the unlisted beta interaction-only, disable/omit reputation, and
remove every reputation claim; test the actual differentiator without delay.
**Alternative:** authorize a real-filter profile only after an agent proposes a
separate data/package budget, feed/cadence/licensing plan, provenance manifest,
sentinel checks, and reproducible build. Reply "AI-9 interaction-only" or
"AI-9 real-filter" (plus constraints). Do not build/commit a feed artifact until
that decision is recorded.

**BLOCKED: AI-8 — PR #273 neutral-chip Gate-3.** The presentation intent is
still reasonable, but the branch is 255 commits behind `main`; its old reviews,
CI, and checkout guide are not actionable. An agent must recreate/refresh or
defer the tiny change, run two fresh reviews and CI, then post a new visual-check
guide. Do not checkout or merge #273 until that handoff exists.

**AI-10 — Gate-3 + merge the SPA-breakage fix (#352) · ✅ RESOLVED 2026-06-23.** Chris ran the manual Chrome check ("manual checks on chrome for #352 done, it seems to be working fine now") → **#352 merged into `main`** (`#347` pushState de-harden + `#348` reputation WAR). The claude.ai grey screen / infinite-load and the per-page `reputation_data.bin`/`pushState` console errors are fixed; top-frame reputation is re-enabled.

**AI-11 — Toast count-pill (#351 → PR #353) · ✅ RESOLVED 2026-06-23 — MERGED.** Chris said "merge #353"; green CI (incl. the RW-19 e2e fix to accept the coalesced pill) → **#353 merged into `main`** (`d0e0412`). Repeated blocked-popup/redirect prompts now coalesce into one count pill after 3-in-8s (expandable to the latest prompt's Allow once / Always allow). The pill is live on the next `git checkout main && npm run build`.

**🚨 BLOCKED: AI-13 — #356 MAIN-world compatibility Gate-3.** This remains a
beta prerequisite, but the branch is 159 commits behind `main` and its E2E check
is red. An agent must merge current `main`, fix the failure, complete two fresh
adversarial reviews, and post a current compatibility/gating checklist. Do not
checkout, test, or merge the present branch.

**🚨 BLOCKED: AI-14 — #399 OAuth tradeoff measurement.** The draft is 70
commits behind `main` and its old CI/counts are stale. It is not a beta blocker.
Keep it draft until #417 supplies valid methodology and an agent refreshes the
branch, runs two reviews, and posts a reproducible headed measurement plan. Do
not checkout or merge the current branch.

**AI-12 — Top-site FP relief + D1 (#350 → PR #354) · ✅ RESOLVED 2026-06-23 — MERGED.** Chris manually confirmed the relief works on LinkedIn ("tested it on linkedin and it seemed to work fine now") = his measure/Gate-3 in lieu of the full `measure:fp` run (which needs headed Chromium + live Tranco, sandbox-can't). **#354 merged into `main`** (`c4426cf`): `getTierAdjustedBlockThreshold` now relieves TOP_SITE + CDS-only (benign-structural whitelist) by `NRS_TOP_SITE_CDS_RELIEF`; trust list grew 24→42 with safe `includeSubdomains`. Green CI (Build/Unit + E2E) on the main-merged head. **Follow-up:** `+20` is an unvalidated starting value; do not tune it again without the valid #417/#416 FP/TP evidence required by D25.

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
