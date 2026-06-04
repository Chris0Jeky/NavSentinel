<!-- AGENT CONTRACT: This file tracks tasks that only the human (Chris) can do.
     - Read it at session start (it is in the CLAUDE.md / AGENTS.md First-5-Minutes list).
     - Surface every OPEN / BLOCKED item near the top of any summary, status report, or handoff you give Chris. Never let an open item go unmentioned.
     - Mark an item DONE *only* when Chris explicitly says so (e.g. "AI-1 is done"). Move it to the Completed log with the date and a one-line result. Do not self-clear.
     - Keep the "Current state snapshot" accurate when verified truth changes. This file is the can't-lose-context store while the status docs on `main` are stale (see note). -->

# ACTION ITEMS — Human-Owned Tasks (NavSentinel)

**Purpose:** the running list of things only *you* (Chris) can do — and the context an agent needs to not lose the thread between sessions. Agents flag the open items in every summary; you clear them by saying so.

**Last updated:** 2026-05-31 · by Claude (session pickup)

> **Why this file exists separately from the usual docs:** the status docs on `main`
> (`docs/agentic/HANDOFF.md`, `docs/agentic/ORCHESTRATOR.md`, `docs/Project_Roadmap.md`,
> `autodoc/AGENT_INDEX.md`) are currently **stale** and **cannot be edited cleanly** because
> all three open PRs already carry divergent edits to those same files. Editing them now =
> merge conflicts. They get reconciled in one pass after the PRs merge (tracked in **issue #184**).
> Until then, **this file + the persistent memory are the source of truth for current state.**

---

## Current state snapshot (verified 2026-06-04)

- `main` == `origin/main` == **`0c9f693`**. This session made **no commits to main** — all work is on PR branches. The 5 PRs below are based on `3eaf382` (a few commits behind main) but `MERGEABLE`.
- **FIVE open PRs**, all **CI green**, each with **two independent adversarial review rounds done this session and ALL findings (every severity) fixed**, **none merged (aging)**:

  | PR | Slice | Branch | Head | What it fixes |
  |----|-------|--------|------|----------------|
  | **#180** | D-PROF | `fix/domain-profile-concurrency` | `2e26e18` | `domain_profile.ts` reader serialization (lost-update race) |
  | **#182** | D-STORE | `fix/prompt-outcome-race` | `ec3ecdc` | `storage.ts` prompt-outcome SW-delegated writes: serialized, sender-validated, retry-only (no resurrection/race) |
  | **#183** | D-FOCUS | `fix/credential-modal-focus-trap` | `131e6d0` | `credential_modal.ts` module-level focus trap |
  | **#185** | D-BRIDGE | `fix/bridge-queue-and-handshake` | `3a60843` | `main_guard.ts` alert-priority outbound buffer (both directions) + 3s handshake timeout + verified-only session pin |
  | **#187** | D-SWRATE | `fix/sw-capture-ratelimit-persist` | `b80609f` | `sw.ts` capture rate-limit Map persisted via SessionStateManager (survives SW restart) |

- **All five are merge-ready except Gate 3 (manual Chrome test) — see AI-1.** That is the *only* outstanding gate. **The manual test now covers all 5 PRs.**
- **Agent sandbox cannot run a browser or spawn threads** — `npm run test:e2e`/`agent:hooks:smoke` fail with launch/thread errors; the same E2E passes on GitHub CI. Gate 3 is genuinely a human task.
- **Remaining implementation slices** (not yet PR'd): **D-ANOM** (`fix/nav-anomaly-sync-lag` branch exists, no commits) — nav_anomaly sync-score lag + sessionNavCount init; **D-IFRAME** (mutation_monitor `data:`/`blob:` iframes); then FF-02→03→04 (stacked), JSB-127, fresh discovery.
- Open issues: #175 #176 #178 #179 #181 (discovery) + #127 (JS behavior) + #184 (housekeeping) + **#186** (bridge init-auth: echo-verify/replay-repin/thrash — needs SW-vouched token) + **#188** (options should surface prompt-outcome import/clear failure).
- **Open question for Chris (deferred per the loop instruction):** the "merge systematically after aged/comments/CI/reviews" instruction vs. the contract's Gate 3 (manual Chrome test, AI-1) — does it authorize merging without the manual test, or hold all merges until AI-1 is cleared? Default assumption: **HOLD** until you confirm.

---

## OPEN action items

### AI-1 — Manual Chrome test (Gate 3) for #180, #182, #183, #185, #187 · **OPEN · BLOCKS ALL MERGES**

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
   - With the modal open, verify focus containment (this is the fix):
     - Press **Tab** / **Shift+Tab** repeatedly → focus must cycle *only* among the modal's buttons, never reaching the page.
     - Click somewhere on the page behind the modal → focus must snap back into the modal.
     - In DevTools console, run `document.querySelector('#submitBtn').focus()` → focus must immediately bounce back into the modal; pressing **Enter** must not activate the page button.
     - **Esc** and the outside/cancel action must still dismiss the modal and return focus sensibly.
5. **#182 D-STORE — prompt outcomes persist:** trigger several credential prompts and choose actions (trust/block) rapidly across reloads; confirm the choices persist and the popup/options reflect them (no lost outcomes). Multiple tabs/frames at once is the stress case.
6. **#180 D-PROF — no console errors under repeated navigation:** browse several risky/benign fixtures repeatedly; confirm no domain-profile errors in the service-worker console and risk state stays consistent.
7. **#185 D-BRIDGE + #187 D-SWRATE — regression smoke (internals, not directly UI-visible):** with each loaded, browse a mix of gym fixtures (nav blocks, dblclick, clipboard/ClickFix, pushstate) and confirm the guard still fires normally and there are **no service-worker or page console errors**. These two change bridge buffering/handshake (#185) and the visual-sim capture rate-limit persistence (#187), so the check is "no regression + no errors" rather than a single golden path.
8. **Record the result on each PR:** `gh pr comment <#> --body "Gate 3 manual Chrome test: PASS — <notes>"` (or FAIL with what broke). Then tell me "AI-1 done for #NNN" and I'll proceed to merge per AI-2.

**Done when:** you've manually verified all five and recorded PASS (or sent fixes back). Tell me which passed.

---

### AI-2 — Merge order decision + execution after Gate 3 · **BLOCKED on AI-1**

**Why it's yours:** merging is an irreversible product action; the contract leaves the go/no-go and order to you.

**Guide:** once AI-1 passes, tell me the order (recommended: oldest-first **#180 → #182 → #183**). I will, per PR: confirm gates, merge, verify `main` afterward by SHA, then move to the next. After the last merge I run the post-merge docs reconciliation (issue #184).

**Done when:** the verified PRs are merged and `main` is confirmed.

---

### AI-3 — Decide the fate of `fix/jsb-stale-todos-and-tests` · **OPEN** · (tracked in #184)

**Why it's yours:** it's an old local branch with one trivial commit; deleting vs. reviving is a judgment call.

**Context:** branch is one commit `435597c` (2026-05-23) that removes stale "TODO: Implement (Slice N)" markers + a dead `computeJsBehaviorScore` stub from `js_behavior_monitor.ts`. It's branched off a *2026-05-23* `main`, so it's far behind — **do not merge it as-is** (would revert ~18.8k lines of since-merged work).

**Guide — pick one:**
- **Abandon:** `git branch -D fix/jsb-stale-todos-and-tests` (the cleanup can be redone fresh if still valid).
- **Revive the intent:** branch off current `main`, re-check whether those 4 docstrings + the dead stub still exist, and re-apply just that cleanup as a fresh small PR (relates to #127).

**Done when:** you tell me to delete it, or to revive its intent as a fresh slice.

---

## Completed log

_(empty — items move here with a date + one-line result when you confirm them done)_
