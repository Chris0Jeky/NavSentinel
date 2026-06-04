<!-- AGENT CONTRACT: This file tracks tasks that only the human (Chris) can do.
     - Read it at session start (it is in the CLAUDE.md / AGENTS.md First-5-Minutes list).
     - Surface every OPEN / BLOCKED item near the top of any summary, status report, or handoff you give Chris. Never let an open item go unmentioned.
     - Mark an item DONE *only* when Chris explicitly says so (e.g. "AI-1 is done"). Move it to the Completed log with the date and a one-line result. Do not self-clear.
     - Keep the "Current state snapshot" accurate when verified truth changes. This file is the can't-lose-context store while the status docs on `main` are stale (see note). -->

# ACTION ITEMS — Human-Owned Tasks (NavSentinel)

**Purpose:** the running list of things only *you* (Chris) can do — and the context an agent needs to not lose the thread between sessions. Agents flag the open items in every summary; you clear them by saying so.

**Last updated:** 2026-06-04 · by Claude (autonomous loop — discovery program complete)

> **Why this file exists separately from the usual docs:** the status docs on `main`
> (`docs/agentic/HANDOFF.md`, `docs/agentic/ORCHESTRATOR.md`, `docs/Project_Roadmap.md`,
> `autodoc/AGENT_INDEX.md`) are currently **stale** and **cannot be edited cleanly** because
> open PRs already carry divergent edits to those same files. Editing them now = merge
> conflicts. They get reconciled in one pass after the PRs merge (tracked in **issue #184**).
> Until then, **this file + the persistent memory are the source of truth for current state.**

---

## Current state snapshot (verified 2026-06-04)

- `main` == `origin/main` == **`aa20213`**. The only commits to `main` this session are this ACTION_ITEMS file; **all code is on the 7 PR branches below.**
- **SEVEN open PRs** — the full discovery program. Each is **CI green (Build/Unit + E2E)**, each has **two or more independent adversarial review rounds with ALL findings (every severity) fixed and a clean final round**, **none merged (aging + awaiting Gate 3)**:

  | PR | Slice | Branch | Head | Rounds | What it fixes |
  |----|-------|--------|------|--------|----------------|
  | **#180** | D-PROF | `fix/domain-profile-concurrency` | `2e26e18` | R1–R2 | `domain_profile.ts` reader serialization (lost-update race) |
  | **#182** | D-STORE | `fix/prompt-outcome-race` | `ec3ecdc` | R1–R3 | `storage.ts` prompt-outcome SW-delegated writes: serialized, sender-validated, retry-only (no resurrection/race) |
  | **#183** | D-FOCUS | `fix/credential-modal-focus-trap` | `131e6d0` | R1–R2 | `credential_modal.ts` module-level focus trap |
  | **#185** | D-BRIDGE | `fix/bridge-queue-and-handshake` | `9da8bcc` | R1–R3 | `main_guard`/`capture_isolated` alert-priority outbound buffer (both directions) + 3s handshake timeout + verified-only session pin. **Also fixed a pre-existing CI-breaking bug it surfaced (see note).** |
  | **#187** | D-SWRATE | `fix/sw-capture-ratelimit-persist` | `55f22c1` | R1–R3 | `sw.ts` capture rate-limit Map persisted via SessionStateManager + hydration-gated handler + corrupt-array guards (read + prune) |
  | **#189** | D-ANOM | `fix/nav-anomaly-sync-lag` | `12aac0c` | R1–R2 | `nav_anomaly.ts` sync-score +1 lag + sync rarity gate (no FP) + `primeAnomalySession` + serialized `clearNavProfile` |
  | **#190** | D-IFRAME | `fix/mutation-data-blob-iframes` | `d5abc52` | R1–R4 | `mutation_monitor.ts` flag injected `data:`/`blob:`/`javascript:` + `srcdoc` iframes; scheme normalized + resolved before the legit-src allowlist (bypass-proof) |

- **All seven are merge-ready except Gate 3 (manual Chrome test) — see AI-1.** That is the *only* outstanding gate. **The manual test now covers all 7 PRs.**
- **Pre-existing bug found + fixed this session (on #185, `9da8bcc`):** `main_guard.patchForms()` hardens `HTMLFormElement.prototype.submit` **non-writable**; `js_behavior_monitor` then did a plain assignment to it, which threw and aborted JS-behavior init (lost signals + a page error). Latent on `main`; #185's bridge timing made it fire reliably, turning E2E red. Now guarded (try/catch + graceful degrade). This reaches `main` when #185 merges; until then the other 6 branches *could* flake on `js-behavior-07`/`visual-sim` E2E — a re-run usually passes. The on-repo `failure_ledger.jsonl` should get an entry post-merge.
- **Agent sandbox cannot run a browser or spawn threads** — `npm run test:e2e` / `agent:hooks:smoke` fail with launch/thread errors locally; the same E2E passes on GitHub CI. Gate 3 is genuinely a human task.
- **Remaining backlog (next, not yet started):** FF-02 → FF-03 → FF-04 (stacked; FF-02 = Vite Firefox build config using `manifest.firefox.json` + dual build scripts — note `@crxjs/vite-plugin` is v2.4.0 and its Firefox support is experimental, so this may need a tooling decision; runtime verification is human-gated like Gate 3). Then JSB-127 (inspect local `fix/jsb-stale-todos-and-tests` first — AI-3), then a fresh discovery pass.
- Open issues: #175 #176 #178 #179 #181 (discovery) + #127 (JS behavior) + #184 (housekeeping) + **#186** (bridge init-auth: echo-verify/replay-repin/thrash — needs SW-vouched token) + **#188** (options should surface prompt-outcome import/clear failure).
- **Open question for Chris (deferred per the loop instruction):** the "merge systematically after aged/comments/CI/reviews" instruction vs. the contract's Gate 3 (manual Chrome test, AI-1) — does it authorize merging without the manual test, or hold all merges until AI-1 is cleared? Default assumption: **HOLD** until you confirm.

---

## OPEN action items

### AI-1 — Manual Chrome test (Gate 3) for #180, #182, #183, #185, #187, #189, #190 · **OPEN · BLOCKS ALL MERGES**

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
10. **Record the result on each PR:** `gh pr comment <#> --body "Gate 3 manual Chrome test: PASS — <notes>"` (or FAIL with what broke). Then tell me "AI-1 done for #NNN" and I'll proceed to merge per AI-2.

**Done when:** you've manually verified all seven and recorded PASS (or sent fixes back). Tell me which passed.

---

### AI-2 — Merge order decision + execution after Gate 3 · **BLOCKED on AI-1**

**Why it's yours:** merging is an irreversible product action; the contract leaves the go/no-go and order to you.

**Guide:** once AI-1 passes, tell me the order (recommended: oldest-first **#180 → #182 → #183 → #185 → #187 → #189 → #190**). I will, per PR: confirm gates, merge, verify `main` afterward by SHA, then move to the next. Note all 7 branch off a slightly older `main`, so each should `git merge main` (not rebase) before merge if conflicts appear. After the last merge I run the post-merge docs reconciliation (issue #184) and add the `failure_ledger.jsonl` entry for the form-submit patch-order bug.

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

## Completed log

_(empty — items move here with a date + one-line result when you confirm them done)_
