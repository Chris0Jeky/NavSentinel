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

## Current state snapshot (verified 2026-05-31)

- `main` == `origin/main` == **`d5670b0`** (this session's only commit to main: the docs/process files; no code changed). The three PRs below are based on the prior main `3eaf382` — one commit behind, but conflict-free/`MERGEABLE` (no file overlap with the docs commit).
- **Three open PRs**, all `MERGEABLE`/`CLEAN`, **CI green**, both adversarial review rounds done, all bot threads resolved/outdated, **none merged (aging)**:

  | PR | Slice | Branch | Head | What it fixes |
  |----|-------|--------|------|----------------|
  | **#180** | D-PROF | `fix/domain-profile-concurrency` | `db0a86c` | `domain_profile.ts` reader serialization through `pending` chain (lost-update race) |
  | **#182** | D-STORE | `fix/prompt-outcome-race` | `155693b` | `storage.ts` prompt-outcome get-modify-write race + weak verify |
  | **#183** | D-FOCUS | `fix/credential-modal-focus-trap` | `dd4647f` | `credential_modal.ts` module-level focus trap (focus can't escape the modal to the page) |

- **All three are merge-ready except Gate 3 (manual Chrome test)** — see AI-1. That is the *only* outstanding gate.
- **Agent sandbox cannot run a browser or spawn threads** — `npm run test:e2e` and `npm run agent:hooks:smoke` fail with launch/teardown timeouts + `Thread failed to start`. The same E2E specs **pass on GitHub CI**. So Gate 3 is genuinely a human task.
- **Next implementation slices** (not yet started, independent, branch off `main`): **D-BRIDGE** (main_guard FIFO-drop + handshake timeout, HIGH×2), **D-SWRATE** (sw rate-limit Map not persisted, HIGH), **D-ANOM** (nav_anomaly burst lag, HIGH+MED), **D-IFRAME** (mutation_monitor `data:`/`blob:` iframes, MED).
- Open issues: #175 #176 #178 #179 #181 (discovery seeds) + #127 (JS behavior) + **#184** (this session's housekeeping).

---

## OPEN action items

### AI-1 — Manual Chrome test (Gate 3) for #180, #182, #183 · **OPEN · BLOCKS ALL MERGES**

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
7. **Record the result on each PR:** `gh pr comment <#> --body "Gate 3 manual Chrome test: PASS — <notes>"` (or FAIL with what broke). Then tell me "AI-1 done for #NNN" and I'll proceed to merge per AI-2.

**Done when:** you've manually verified all three and recorded PASS (or sent fixes back). Tell me which passed.

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
