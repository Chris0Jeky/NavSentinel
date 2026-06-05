<!-- AGENT CONTRACT: This file tracks tasks that only the human (Chris) can do.
     - Read it at session start (it is in the CLAUDE.md / AGENTS.md First-5-Minutes list).
     - Surface every OPEN / BLOCKED item near the top of any summary, status report, or handoff you give Chris. Never let an open item go unmentioned.
     - Mark an item DONE *only* when Chris explicitly says so (e.g. "AI-1 is done"). Move it to the Completed log with the date and a one-line result. Do not self-clear.
     - Keep the "Current state snapshot" accurate when verified truth changes. This file is the can't-lose-context store while the status docs on `main` are stale (see note). -->

# ACTION ITEMS — Human-Owned Tasks (NavSentinel)

**Purpose:** the running list of things only *you* (Chris) can do — and the context an agent needs to not lose the thread between sessions. Agents flag the open items in every summary; you clear them by saying so.

**Last updated:** 2026-06-05 · by Claude — **ALL 11 PRs MERGED** (Chris waived Gate 3 for the batch; deferred to a manual-verification watchlist). `main` @ `4bd60ce`, 0 open PRs. Docs reconciled (#184).

> **Why this file exists separately from the usual docs:** the status docs on `main`
> (`docs/agentic/HANDOFF.md`, `docs/agentic/ORCHESTRATOR.md`, `docs/Project_Roadmap.md`,
> `autodoc/AGENT_INDEX.md`) are currently **stale** and **cannot be edited cleanly** because
> open PRs already carry divergent edits to those same files. Editing them now = merge
> conflicts. They get reconciled in one pass after the PRs merge (tracked in **issue #184**).
> Until then, **this file + the persistent memory are the source of truth for current state.**

---

## Current state snapshot (verified 2026-06-05)

- `main` == `origin/main` == **`4bd60ce`**, working tree clean. **0 open PRs.** Only local branch besides `main` is `fix/jsb-stale-todos-and-tests` (AI-3, untouched).
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

---

## Action items

**OPEN: AI-3, AI-4, AI-5.** AI-1 and AI-2 are ✅ **resolved 2026-06-05** (see Completed log). The deferred manual checks now live in `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md`.

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

### AI-3 — Decide the fate of `fix/jsb-stale-todos-and-tests` · **OPEN** · (tracked in #184)

**Why it's yours:** it's an old local branch with one trivial commit; deleting vs. reviving is a judgment call.

**Context:** branch is one commit `435597c` (2026-05-23) that removes stale "TODO: Implement (Slice N)" markers + a dead `computeJsBehaviorScore` stub from `js_behavior_monitor.ts`. It's branched off a *2026-05-23* `main`, so it's far behind — **do not merge it as-is** (would revert ~18.8k lines of since-merged work).

**Guide — pick one:**
- **Abandon:** `git branch -D fix/jsb-stale-todos-and-tests` (the cleanup can be redone fresh if still valid).
- **Revive the intent:** branch off current `main`, re-check whether those markers + the dead stub still exist, and re-apply just that cleanup as a fresh small PR (relates to #127).

**Done when:** you tell me to delete it, or to revive its intent as a fresh slice.

---

### AI-4 — Decide Firefox build tooling for FF-02 · **OPEN** · (blocks the FF-02 → FF-03 → FF-04 stack)

**Why it's yours:** a tooling/architecture choice with trade-offs that shapes the whole Firefox port.

**Context:** FF-01 (`browser.*` shim) merged (#173). FF-02 needs a Vite Firefox build, but `@crxjs/vite-plugin` (v2.4.0) Firefox support is experimental. Options:
- (a) crxjs Firefox target (least new tooling, but experimental/risky);
- (b) `web-ext` + a separate `manifest.firefox.json` and build script (battle-tested for Firefox; more moving parts);
- (c) a hand-rolled second Vite config consuming `manifest.firefox.json` + dual build scripts.

Runtime verification will be human-gated (like Gate 3 — sandbox can't drive Firefox).

**Done when:** you pick the approach; I implement FF-02 against it (then FF-03/FF-04 stack on top).

---

### AI-5 — Provide sanctioned brand login screenshots for P4-01c · **OPEN** · (unblocks real visual-sim spoof detection)

**Why it's yours:** the visual-similarity pipeline is fully built and wired but ships **PLACEHOLDER** template hashes (`scripts/build-brand-templates.mjs` emits seeded-PRNG values), so it can never fire a true positive. Replacing them needs hashes built from **real brand login pages** — sourcing/sanctioning those screenshots is a product/legal call only you can make.

**Context:** P4-01c in `docs/Project_Roadmap.md` + `docs/agentic/ORCHESTRATOR.md` (BLOCKED). Until real templates exist, visual-sim is plumbing-complete, detection-pending.

**Done when:** you supply (or point me to) a sanctioned set of brand login screenshots, or decide to defer P4-01c indefinitely.

---

## Completed log

- **AI-1 — Gate 3 manual Chrome test · WAIVED → DEFERRED · 2026-06-05.** Chris waived the manual-test gate for the 11-PR batch; merges proceeded on fresh-green CI + 2× independent adversarial review. Manual checks preserved as a deferred regression watchlist in `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` (run on next build + load).
- **AI-2 — Merge order + execution · DONE · 2026-06-05.** All 11 D-series PRs merged oldest-first (#180, #182, #183, #185, #187, #189, #190, #191, #193, #194, #195). #182 merged last after a docs-only conflict (resolved by taking `main`; verified tsc clean / lint 0/0 / 2298 unit tests + green CI on the merge head). `main` @ `4bd60ce`, 0 open PRs, branches pruned.
