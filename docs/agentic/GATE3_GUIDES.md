<!-- AGENT CONTRACT: stable, tracked home for the long human Gate-3 guides.
     - `ACTION_ITEMS.md` remains the durable human-task REGISTER (what is open, who owns it).
       This file holds the long step-by-step PROCEDURES those items reference, so the register
       stays readable without pushing the guides onto mutable PR branches.
     - Only Chris can record a Gate-3 as done. Agents may refresh the pinned heads and the
       verified-state lines here when live truth changes, and must not weaken a check.
     - Every guide is precheck-gated: if step 1's exact-head equality fails, STOP and report the
       mismatch rather than proceeding. -->

# Human Gate-3 Guides — NavSentinel

## Completed record: AI-29 - issue #555 opt-in overlay cleanup

Completed 2026-08-28 on PR #557 at
`ee804fa8d45f34284e073b7054cdc558b14b025d`. Chris reported that the exact
owner-loaded overlay cleanup works as intended, accepted the remaining
fail-closed regular redirect-card Dismiss/Allow-once regression tracked in #560,
and explicitly authorized merge. The Chrome version was not supplied. The
procedure below is retained as evidence of what this gate covered; it is not an
active action and must not be rerun or inferred from automation alone.

1. Resolve the open PR whose head is `feat/issue555-overlay-cleanup`. Record its
   PR number and 40-character `headRefOid`. In the implementation worktree,
   require `git rev-parse HEAD` to equal that value and require `git status
   --short` to contain no uncommitted product changes. The known Defender
   quarantine may appear only as ` D tests/clickfix-detector.property.test.ts`;
   do not restore, inspect, stage, execute, or allow that fixture. Stop on any
   other mismatch.
2. On that exact head, run `npm ci`, `npm run build`, and
   `npm run check:content-loader`. Record the exact `extension/dist` path and the
   reported guard revision. Loading or reloading the unpacked extension is
   Chris-owned: the agent stops at this boundary and must not control
   `chrome://extensions` or try an alternate reload path. In Chrome, Chris
   creates a fresh temporary profile, enables Developer mode, and loads that
   exact `extension/dist` unpacked. Record the Chrome version and confirm the
   extension service worker registers without an error.
3. Open the options page. Confirm **Auto-dismiss overlays** is off by default,
   its description says it acts only on high-risk detected overlays, and the
   switch works by mouse and keyboard. Confirm the extension popup exposes the
   same default-off quick setting and that its checkbox works by mouse and
   keyboard. Turn it on in the popup, close/reopen both surfaces, and confirm it
   remains on. Reload an already-open Options page before using its current
   manual Save; cross-surface live synchronization is tracked separately in
   #558.
4. Start the tracked local Gym (`npm run gym:serve`) and open
   `mutation-01-delayed-overlay.html`. For this human trial, do not dispatch the
   page's `navsentinel:gym:trigger-mutation` event; that is an E2E-only
   monitor-ready trigger. Before testing, confirm this target document reports
   `capture="1"`, `bridge="1"`, and the same `ui-guard` revision from
   step 2 for the `data-navsentinel-capture-ready`,
   `data-navsentinel-bridge-ready`, and `data-navsentinel-ui-guard` attributes.
   Stop on a missing or old marker: the target page does not prove the expected
   artifact. Leave the page open and wait for the visible **Human
   fallback countdown** to reach zero (the fixture's 10-second fallback; no
   click is needed). Confirm the fake session overlay is hidden automatically,
   the timing line identifies the human fallback timer, a small **Overlay hidden;
   still watching** status with **Undo** appears, the underlying page is usable,
   and no popup or navigation occurs. The status leaves after about 2 seconds or
   the next pointer interaction outside it, so be ready at the end of the visible
   countdown and click **Undo** promptly. Confirm the same overlay is visible
   again; reload and repeat this step if the brief recovery window expires.
5. With cleanup still enabled, open the popup once and confirm its checkbox is
   still on. Then open `evasion-02-size-34pct.html` and do not interact with the
   page. Normally within about 500 ms after DOM readiness (allow up to 2 seconds
   for this manual check), confirm the pink high-severity trap disappears
   automatically, the visible **Real Link** is exposed, no popup/navigation
   occurs, and the small card contains **Overlay hidden; still watching** with
   no separate Dismiss button. Click **Undo** within its 2-second recovery
   window and confirm the trap returns without any click being
   synthesized or replayed. Then click the restored trap once to exercise the
   fallback: the new tab must stay blocked, the trap must hide again, and the
   card must contain **(overlay hidden)** with Undo. A trap that stays until this
   first click is a failure of automatic cleanup even if the click-time fallback
   succeeds.
6. Open `evasion-12-multiple-overlays.html` without interacting. Confirm both
   stacked traps disappear within the same 2-second allowance, **Real Link** is
   exposed, no tab/navigation occurs, and one small card contains **Overlay
   hidden; still watching**. Click **Undo** within its brief recovery window and
   confirm both trap
   layers return and stay restored. Then open
   `mutation-05-sequential-overlays.html`, wait for its 10-second human fallback
   and the second delayed layer, and confirm both layers stay hidden. Use the
   brief Undo notice created by the delayed cleanup (reload and repeat if its
   2-second window expires) and confirm one Undo restores the grouped layers and
   they remain restored.
7. Open `overlay-nesting-lab.html?case=exact` without interacting. Confirm the
   outer synthetic media frame remains present but its nested advertisement
   disappears, **Nested frame content exposed** becomes visible, and the small
   Undo card appears inside that media frame. Click **Undo** within 2 seconds and
   confirm the nested
   advertisement returns without opening a tab or replaying a click.
8. Open `overlay-nesting-lab.html?case=hostile`. Click the brief **Undo** once
   and confirm the fixture's window capture-phase **Page-level control events
   observed** counter remains `0`, the layer returns, and no blocked popup or new
   tab appears. Reload the fixture and leave it untouched for at least 8 seconds.
   The nested advertisement must disappear and stay hidden while the fixture
   fills the ordinary alert lane, rewrites the original layer, replaces it, and
   settles. Reload once more and, while the brief notice is present, click
   **Trigger scroll-time reinsertion** outside it. The page interaction must be
   delivered, the notice must leave, and the new layer must also disappear
   without a popup or new tab. In Options
   > Event Log, confirm the local row identifies the cleanup outcome; do not
   export or share unrelated browsing rows. Then open
   `overlay-nesting-lab.html?case=compact-hostile` and confirm its compact
   interactive attack disappears. Open the `case=benign` variant and confirm
   all three controls labelled **expected visible** remain visible.
9. Turn cleanup off and repeat the mutation fixture: the overlay must remain
   visible and the warning must remain available. Then set Navigation mode Off,
   enable cleanup, repeat once more, and confirm NavSentinel neither hides nor
   blocks page content in Off mode.
10. Restore Smart mode and enable cleanup. Exercise
   `level7-legit-modal-backdrop.html` and `level9-legit-video-overlay.html`.
   Confirm the dialog/backdrop and video controls remain visible and usable.
11. Inspect the page and extension service-worker consoles for new errors. On a
   pass, reply `AI-29 done; Gate-3 passed on PR #<n> at <40-character SHA>;
   Chrome <version>`. On any mismatch, reply `AI-29 failed on PR #<n> at <SHA>:
   <step and observed>` and leave the item open.

Chris recorded AI-29 complete through the exact-head acceptance and merge
authorization above. Automated Playwright evidence supported but did not replace
that owner result. The missing templated reply and Chrome version are recorded
limitations, not a reason to reopen the completed gate.

---

## Active guide: AI-33 — issue #530 popup trust-pill contrast

Run this only after the #530 implementation PR is ready and every automated
check for its current head is green.

1. Resolve the open PR whose head is `fix/issue530-trust-pill-contrast`. Record
   its PR number and 40-character `headRefOid`. In the implementation worktree,
   require `git rev-parse HEAD` to equal that value and confirm there are no
   uncommitted product changes. If Defender quarantines
   `tests/clickfix-detector.property.test.ts`, do not allow, inspect, restore, or
   stage it; record that limitation. Stop on any other mismatch.
2. Require the exact-head Build / Unit and E2E checks to be green and all review
   findings to be triaged. Run `npm ci`,
   `npx vitest run tests/popup-contrast.test.ts`, `npm run typecheck`,
   `npm run build`, and `npm run check:perf-budget` in that worktree.
3. In a second terminal in that worktree, run `npm run gym:serve` and require it
   to start successfully on port 5173. Keep that process running for the trial;
   stop rather than substitute another server if the strict port check fails.
4. In a fresh temporary Chrome profile, load that worktree's `extension/dist`
   unpacked. After any rebuild, click **Reload** for NavSentinel in
   `chrome://extensions` before reloading a page. Record the Chrome version.
5. Open `http://127.0.0.1:5173/` and then open the NavSentinel popup.
   Confirm the gold observing trust pill is readable, fully visible, and not
   confused with the orange or green signal chips. Its text label must remain
   present so the state does not rely on colour alone.
6. Reach the popup's **Trust** action with Tab and activate it with Enter. Reopen
   the popup if Chrome closes it after activation. Confirm the trusted pill is
   readable, fully visible, and distinguishable by its label and green treatment.
   Use the keyboard to reverse the state and confirm the observing treatment
   returns without clipping or stale text.
7. Inspect the popup console for new errors, then stop the Gym server. On a pass,
   reply `AI-33 done;
   Gate-3 passed on PR #<n> at <40-character SHA>; Chrome <version>`. On any
   mismatch, reply `AI-33 failed on PR #<n> at <SHA>: <step and observed>` and
   leave the item open.

Only Chris can record AI-33 complete. The computed WCAG test supports but does
not replace this exact-head visual and keyboard gate.

---

## Active guide: AI-30 - PR #570 Back/Forward history integrity

Run this only after PR #570 is ready and every automated check for its current
head is green.

1. Resolve PR #570 and record its 40-character `headRefOid`. In the implementation
   worktree, require `git rev-parse HEAD` to equal that value. `git status --short`
   must contain no uncommitted product changes. The known Defender quarantine may
   appear only as ` D tests/clickfix-detector.property.test.ts`; do not restore,
   allow, inspect, stage, or exclude that fixture. Stop for any other mismatch.
2. On that exact head, run `npm ci` and `npm run build`. Create a fresh temporary
   Chrome profile, leave it unsigned-in, enable Developer mode at
   `chrome://extensions`, and load `extension/dist` unpacked. Record the Chrome
   version and confirm the extension service worker registers without an error.
   In NavSentinel Options, use Smart Navigation mode and confirm neither
   `localhost` nor `127.0.0.1` is allowlisted or trusted.
3. Start the tracked Gym with `npm run gym:serve`, then open
   `http://127.0.0.1:5173/history-01-back-forward.html?step=p`. Follow the visible
   link from P to A and from A to B. Confirm the host alternates between
   `127.0.0.1:5173` and `localhost:5173`, proving the fixture crossed sites.
4. On B, wait at least 11 seconds so the normal click and recent-navigation
   allowances expire. Use Chrome's physical **Back** control. Confirm A loads and
   remains on screen for at least two seconds with no rollback, prompt, or toast.
   Use physical **Forward** and confirm B remains stable. Then use **Back** twice:
   the first action must remain on A and the second must reach P. A jump from B
   directly to P, or a return from A to B, is a failure. Repeat the first
   B -> A action with the mouse history shortcut if the test mouse exposes one.
5. Open `level10-redirects-and-forms.html`, click **Delayed redirect**, and confirm
   the destination briefly commits before NavSentinel returns to the Level 10
   page. This proves a later page-initiated redirect is still evaluated normally.
6. Inspect the History fixture, Level 10, and extension service-worker consoles
   for new errors. On a pass, reply `AI-30 done; Gate-3 passed on PR #570 at
   <40-character SHA>; Chrome <version>`. On any mismatch, reply `AI-30 failed on
   PR #570 at <SHA>: <step and observed>` and leave the item open.

Only Chris can record AI-30 complete. Automated Playwright evidence supports but
does not replace this exact-head manual browser gate.

---

> ## ⚠️ SUPERSEDED 2026-07-25 — read before running anything here
>
> **All three PRs these guides gate have merged**, and Chris chose to clear their
> gates by **automated equivalent** rather than by a manual pass:
> #356 (`3bd9e02`), #464 (`c4f6183`), #466 (`4ff6341`).
> **AI-13, AI-21 and AI-22 no longer exist as items.**
>
> Consequences for anyone reading below:
> 1. **Every step-1 exact-head precheck will fail**, correctly — it compares a
>    worktree against `gh pr view <n> --json headRefOid` and `git ls-remote` for
>    branches whose PRs are merged. That is not a defect to work around; it is the
>    precheck telling you the guide's premise is gone.
> 2. **Do not use the `<AI-N> done; Gate-3 passed on PR #<n>` reply lines.** They
>    would record a Gate-3 pass that `ACTION_ITEMS.md` states was never recorded.
> 3. These procedures are retained as **reference material for `AI-24`**, the single
>    optional post-merge real-Chrome confirmation pass over the merged result. To run
>    that: build from current `main`, load `extension/dist` unpacked in a fresh
>    temporary Chrome profile, execute the behavioural steps below (skipping every
>    precheck and every per-PR reply line), and reply **`AI-24 done`** with Chrome's
>    version — or `AI-24 failed: <step and observed result>`.
>
> Testing the merged result is deliberately better evidence than three per-branch
> passes: the three changes interact (#356 de-hardened the location hook so delayed
> redirects rely on rollback; #464 removed pointerdown-derived authority), and the
> merged state is what users actually run. Only Chris can record AI-24 complete, and
> nothing is blocked on it.

Long-form procedures for the human-owned manual Chrome gates tracked in
[`../../ACTION_ITEMS.md`](../../ACTION_ITEMS.md). The register there is the source of truth for
**which** items are open; this file is the source of truth for **how** to run them.

**Why this file exists (2026-07-24):** the AI-21 and AI-22 guides previously existed only inside
`ACTION_ITEMS.md` *on their own PR branches*, which carry a far longer version of that file than
`main`. That made the durable register incomplete on `main` and made the guides reachable only via
`git show` against a remote-tracking ref a fresh checkout may not have. Both guides are now
tracked here, verbatim from their branches (on `main` once this change merges). Kept as a separate file so that landing
those PRs does not collide with a large `ACTION_ITEMS.md` rewrite.

**Heads move.** These guides deliberately carry no head pins — each derives its head in step 1,
which is the right pattern. The pins live in `ACTION_ITEMS.md`, `HANDOFF.md`,
`Project_Roadmap.md` and `ORCHESTRATOR.md`, and were live on 2026-07-24. Trust step 1 over any
SHA written elsewhere: a stale pin is exactly what made the AI-13 guide abort on its own
precheck.

## AI-36 — #558 popup/Options patch-save synchronization Gate-3

**🚨 OPEN: AI-36 — Run the #558 popup/Options patch-save synchronization
Gate-3 (GUIDE PREPARED; LIVE EXACT-HEAD PRECHECK REQUIRED).** This bounded
browser-surface slice makes an open Options page adopt clean settings changed in
the popup, preserves unrelated dirty Options fields, and saves only dirty leaf
patches through one service-worker-owned write queue. It does not yet add the
auto-save preference, prominent manual dirty-state UX, or same-field conflict UX
that remain in #558. Only Chris can record this item complete.

**Current guide:**

1. From the repository root, use the existing worktree for branch
   `fix/issue558-patch-save-sync`; do not switch or reset root `main`. Refresh
   the branch and prove the exact head before running a browser:

   ```sh
   BRANCH=fix/issue558-patch-save-sync
   WORKTREE=<path-to-the-worktree-for-the-branch>
   git -C "$WORKTREE" fetch origin "$BRANCH"
   git -C "$WORKTREE" status --short --branch
   git -C "$WORKTREE" rev-parse HEAD
   git ls-remote origin "refs/heads/$BRANCH"
   PR=$(gh pr list --state open --head "$BRANCH" --json number --jq '.[0].number')
   test -n "$PR"
   gh pr view "$PR" --json headRefName,headRefOid,state
   gh pr checks "$PR"
   ```

   The worktree must be clean except for the one already-ledgered Windows
   Defender quarantine line ` D tests/clickfix-detector.property.test.ts`.
   If that exact deletion is present, record it and leave it untouched: do not
   open, restore, stage, or allow the fixture. Stop for every other status line.
   `headRefName` must be the named branch, and the local HEAD, remote branch SHA,
   and PR head SHA must be identical. Build/Unit and E2E must be green on that
   exact head, and no required review thread may remain unresolved. If the branch
   has not been pushed or the PR lookup is empty, stop and report that
   precondition; never test a stale build.
2. In that exact worktree run `npm ci`, then `npm run build`. Create a
   disposable, fresh Chrome profile without signing in or changing an
   established profile. Load the exact `<worktree>/extension/dist` directory
   unpacked from `chrome://extensions`. If the extension was already loaded,
   use **Reload** there before opening either extension surface. Open the
   service-worker inspector and keep it visible for errors.
3. Open NavSentinel Options. Establish a visible baseline with Navigation
   **Smart**, Credential **Smart**, and **Paste warnings**
   checked, then click **Save**. Reload Options once and confirm that baseline.
4. In Options, uncheck **Paste warnings**, but do **not** click
   Save. This is the unrelated dirty field that must survive an external update.
   Do not edit either protection-mode control in Options during this trial.
5. Open the NavSentinel popup and set Navigation to **Strict**, then Credential
   protection to **Strict**. Leave the popup open until both selected states are
   visible. Do not press Save in Options yet.
6. Return to the already-open Options page without reloading it. Navigation and
   Credential protection must both now show **Strict**, while **Paste warnings**
   must remain unchecked. In the service-worker inspector,
   verify the persisted state still holds the popup modes and the old checkbox
   value because the dirty checkbox has not been saved:

   ```js
   (await chrome.storage.local.get("sentinelsuite:settings_v1"))
     ["sentinelsuite:settings_v1"]
   ```

   Expect `nav.defaultMode === "strict"`, `credential.mode === "strict"`, and
   `credential.warnOnPaste === true`. A reloaded Options page, reverted dirty
   checkbox, stale mode control, or console error is a failure.
7. Click **Save** in Options. Poll the same storage key again. The two popup
   modes must remain `"strict"`, and `credential.warnOnPaste` must now be
   `false`. Reopen the popup and confirm both mode segments still show Strict.
   Reload Options and confirm all three saved values remain. This proves the
   Options save applied its dirty leaf without reconstructing a stale settings
   object over the popup changes.
8. Inspect the Options, popup, and service-worker consoles. Record any rejected
   `ns-suite-settings-update` message, runtime messaging error, stale control,
   lost setting, duplicate write symptom, or unrelated console error as a
   failure. Close the disposable profile and remove only that profile; do not
   alter an established profile or disable security software.
9. Only Chris may record completion. Reply
   `AI-36 done; Gate-3 passed on branch fix/issue558-patch-save-sync at
   <40-character SHA>; Chrome <version>` with console observations, or
   `AI-36 failed on branch fix/issue558-patch-save-sync at <SHA>: <step and
   observed result>`. Do not merge on a partial pass; recheck exact head, CI,
   comments, and the repository merge gate afterward.

## AI-35 — #539 cross-host child-event attribution Gate-3

**🚨 OPEN: AI-35 — Run the #539 cross-host child-event attribution Gate-3
(GUIDE PREPARED; LIVE EXACT-HEAD PRECHECK REQUIRED).** This browser-surface
slice keeps the emitting frame hostname in `site` while adding a minimized,
service-worker-derived `pageSite` for the top-level HTTP(S) tab. The popup uses
that association for its current-page threat state and falls back to `site` for
legacy rows. It does not add tab or navigation identity; that remains #215.
Only Chris can record this item complete.

**Current guide:**

1. From the repository root, use the existing worktree for branch
   `fix/issue539-page-attribution`; do not switch or reset root `main`. Refresh
   the branch and prove the exact head before running a browser:

   ```sh
   BRANCH=fix/issue539-page-attribution
   WORKTREE=<path-to-the-worktree-for-the-branch>
   git -C "$WORKTREE" fetch origin "$BRANCH"
   git -C "$WORKTREE" status --short --branch
   git -C "$WORKTREE" rev-parse HEAD
   git ls-remote origin "refs/heads/$BRANCH"
   PR=$(gh pr list --state open --head "$BRANCH" --json number --jq '.[0].number')
   test -n "$PR"
   gh pr view "$PR" --json headRefName,headRefOid,state
   gh pr checks "$PR"
   ```

   The worktree must be clean except for the one already-ledgered Windows
   Defender quarantine line ` D tests/clickfix-detector.property.test.ts`.
   If that exact deletion is present, record it and leave it untouched: do not
   open, restore, stage, or allow the fixture. Stop for every other status line.
   `headRefName` must be the named branch, and the local HEAD, remote branch SHA,
   and PR head SHA must be identical. All checks exercising the branch must be
   green and no required review thread may remain unresolved. If the branch has
   not yet been pushed or the PR lookup is empty, stop and report that
   precondition; never test a stale build.
2. In that exact worktree run `npm ci`, then `npm run build`. Start the Gym with
   `python -m http.server 5173 --bind 127.0.0.1 --directory gym` in a second
   terminal. Create a disposable, fresh Chrome profile without signing in or
   changing an established profile. Load the exact
   `<worktree>/extension/dist` directory unpacked from `chrome://extensions`.
   Confirm Navigation is **Smart** and no localhost/127.0.0.1 allowlist entry is
   present. If the extension was already loaded, use **Reload** in
   `chrome://extensions` before opening the Gym page.
3. Open `http://127.0.0.1:5173/index.html?ai35=top`. In page DevTools confirm
   both readiness markers are `"1"`:

   ```js
   ["data-navsentinel-capture-ready", "data-navsentinel-bridge-ready"].map(
     (name) => document.documentElement.getAttribute(name)
   )
   ```

   In the top page's DevTools, inject a visible child frame served by the other
   loopback hostname, then wait for its load and select that frame's DevTools
   context to confirm the same two readiness markers:

   ```js
   await (async () => {
     const frame = document.createElement("iframe");
     frame.id = "ai35-child-frame";
     frame.src = `http://localhost:${location.port}/level1-basic-opacity.html?ai35=child`;
     frame.style.cssText =
       "position:fixed;left:24px;top:160px;width:520px;height:360px;z-index:2147483647;border:1px solid #777";
     const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
     document.body.appendChild(frame);
     await loaded;
     return frame.src;
   })();
   ```

   If Chrome shows its self-XSS paste warning, review the exact local-only
   snippet before following the prompt manually; never disable the warning or
   paste unrelated code.
4. Open NavSentinel's service-worker inspector from `chrome://extensions` and,
   after both page and child bridges are ready, clear only this disposable
   profile's event log:

   ```js
   await chrome.storage.local.set({ "sentinelsuite:event_log_v1": [] });
   ```

   Return to the child frame, identify its visible **Play** button, and click
   its coordinates physically once. The Level-1 transparent trap receives this
   trusted click and should produce one `nav_blank_prompt`; no destination tab
   should be opened. In the service-worker inspector, poll the event log and
   verify the matching row has exactly the meaningful attribution fields:

   ```js
   (await chrome.storage.local.get("sentinelsuite:event_log_v1"))
     ["sentinelsuite:event_log_v1"]
     .filter((entry) => entry.kind === "nav_blank_prompt")
     .at(-1)
   // Expected: { site: "localhost", pageSite: "127.0.0.1", ... }
   ```

   `site` must remain `localhost`; `pageSite` must be `127.0.0.1`; neither may
   contain a path, query, fragment, or full URL. Capture any different value,
   missing event, opened destination, or page/service-worker console error.
5. With the first tab's event retained, open a second top-level tab at
   `http://localhost:5173/index.html?ai35=unrelated`, wait for its NavSentinel
   readiness markers, and open the extension popup while that localhost tab is
   active. The **Current page** card must not show the prior event's
   `Threat alert recorded, no risk score` note or its threat signal; the current
   gauge must remain clear. The activity feed may still list the global event,
   which is expected and is not current-page attribution. Switch back to the
   127.0.0.1 tab and reopen the popup to confirm the threat note is restored
   there. Record any cross-tab leakage or popup console error as a failure.
6. Close all test tabs and DevTools windows, stop the Python server with
   Ctrl+C, close the disposable Chrome profile, and remove only that disposable
   profile. Do not alter an established profile or disable security software.
7. Only Chris may record completion. Reply
   `AI-35 done; Gate-3 passed on branch fix/issue539-page-attribution at
   <40-character SHA>; Chrome <version>` with console observations, or
   `AI-35 failed on branch fix/issue539-page-attribution at <SHA>: <step and
   observed result>`. Do not merge on a partial pass; recheck exact head, CI,
   comments, and the repository merge gate afterward.

## AI-37 — #523 bridge queue-pressure Gate-3

**OPEN: AI-37 — Run the #523 successor bridge queue-pressure Gate-3 (GUIDE
PREPARED; LIVE EXACT-HEAD PRECHECK REQUIRED).** This bounded browser-surface
guide checks that the queue-pressure repair preserves legitimate clipboard use
and cannot suppress the next verified ClickFix signal. The hostile unverified
retry and 64-write pressure oracle remain automated-only because they use the
known page-visible same-session handshake weakness in #186. This guide does not
complete C-04, prove general bridge identity, or establish OS paste or execution
prevention. It also resolves the explicit queue-semantics owner decision still
open in #523; browser success alone does not imply that decision. Only Chris can
record this item complete.

1. Resolve PR #599 and require its head branch to be
   `fix/issue523-unverified-clipboard-cap`. Record its 40-character
   `headRefOid`. In its implementation worktree, require `git rev-parse HEAD`
   to equal that value and the remote branch SHA. The worktree may contain only
   the already-ledgered Windows Defender quarantine line
   ` D tests/clickfix-detector.property.test.ts`; do not open, restore, allow,
   inspect, or stage that fixture. Stop on any other mismatch. Require all
   exact-head hosted checks green, the required independent review complete,
   and every review finding triaged before opening Chrome. Review the proposed
   policy and explicitly accept or reject it: before verification, keep only the
   latest command-like and latest non-command clipboard receipt; after
   verification, deliver every successful clipboard write directly. Stop if
   that policy is not accepted rather than treating the later browser steps as
   implicit approval.
2. On that exact head run `npm ci`,
   `npx vitest run tests/bridge-outbound.test.ts`, `npm run typecheck`,
   `npm run build`, `npm run check:content-loader`, and
   `npm run check:perf-budget`. Record the build's capture, bridge, and UI-guard
   markers. Loading or reloading the unpacked extension is Chris-owned: the
   agent stops at this boundary and must not operate `chrome://extensions`.
3. Start the tracked local Gym with `npm run gym:serve`. In a fresh unsigned-in
   Chrome profile, load this exact worktree's `extension/dist` unpacked, record
   the Chrome version, and confirm its service worker registers without an
   error. In NavSentinel Options select Smart mode and confirm neither
   `localhost` nor `127.0.0.1` is trusted or allowlisted.
4. Open
   `http://127.0.0.1:5173/clickfix-03-legit-captcha.html?ai37=benign`. Confirm
   `data-navsentinel-capture-ready` and `data-navsentinel-bridge-ready` are both
   `"1"`. Physically click **Copy Code**. The status must report **OTP copied**,
   the page must remain usable, and no ClickFix or clipboard warning may appear
   during the next two seconds. Physically select the local inert verification
   checkbox as a second benign control; it must remain usable without a warning.
5. Open
   `http://127.0.0.1:5173/clickfix-01-basic.html?ai37=mixed` and require the same
   two readiness markers. In that page's ordinary DevTools console run only
   `await navigator.clipboard.writeText("847293")`; this is the bounded benign
   prewrite. Promptly return to the page and physically click **I am not a
   robot** once. Do not open an OS Run dialog and do not paste or execute the
   clipboard value. The page status must report that its inert sentinel write
   completed, and NavSentinel must show its fake-verification/clipboard warning.
   A missing warning is a failure even if the page status changes normally.
6. Open NavSentinel Options > Event Log. Confirm the mixed trial recorded a
   `clickfix_detected` event and the benign page did not. Confirm neither trial
   added a `bridge_buffer_overflow` row. The log must not display either raw
   clipboard value. Do not export or share unrelated browsing rows.
7. Inspect the two page consoles and the extension service-worker console for
   new errors. Close all test tabs and DevTools windows, stop the Gym server,
   close the disposable profile, and remove only that profile. Do not alter an
   established profile or disable security software.
8. On a policy acceptance and browser pass, reply `AI-37 approved queue design;
   Gate-3 passed on PR #<n> at <40-character SHA>; Chrome <version>` with any
   console observations. If the policy is not accepted, reply `AI-37 rejected
   queue design: <reason>` without running the browser steps. On a browser
   mismatch, reply `AI-37 failed on PR #<n> at <SHA>: <step and observed
   result>` and leave the item open. The agent must then recheck the exact head,
   CI, comments, and merge gate; no partial pass authorizes merge.

## Index

| Item | PR | Guide |
|---|---|---|
| AI-13 | #356 MAIN-world compatibility | in [`../../ACTION_ITEMS.md`](../../ACTION_ITEMS.md) |
| AI-21 | #464 synthetic navigation | [below](#ai-21--pr-464-synthetic-navigation-gate-3) |
| AI-22 | #466 pending-decision service worker | [below](#ai-22--pr-466-pending-decision-service-worker-gate-3) |
| AI-37 | #523 bridge queue pressure | [above](#ai-37--523-bridge-queue-pressure-gate-3) |
| AI-36 | #558 popup/Options patch-save synchronization | [above](#ai-36--558-popupoptions-patch-save-synchronization-gate-3) |
| AI-35 | #539 cross-host child-event attribution | [below](#ai-35--539-cross-host-child-event-attribution-gate-3) |

~~Run them oldest-PR-first: AI-13 (#356) -> AI-21 (#464) -> AI-22 (#466).~~
**Void 2026-07-25** — all three merged with their manual gates waived. There is no
run order; there is one optional confirmation pass, AI-24.

---

## AI-21 — PR #464 synthetic-navigation Gate-3

*Verbatim from `ACTION_ITEMS.md` on branch `fix/ri01-reject-synthetic-nav-allowances`.*

**🚨 OPEN: AI-21 — Run PR #464 synthetic-navigation Gate-3 (GUIDE PREPARED;
LIVE EXACT-HEAD PRECHECK REQUIRED).** This browser-surface slice prevents page
scripts from minting navigation authority with dispatched pointer/click events,
while retaining a preceding real pointerdown only as attack-correlation
evidence. A trusted pointerdown now sends only a top-frame rollback baseline;
it cannot create gesture, broad, target, or recent-user authority. Automated
Chromium proves the pointerdown-only rollback attack, the synchronous
MAIN-world popup attack, existing synthetic attacks, and trusted compatibility
paths, plus Navigation Off's programmatic bypass, but a real Chrome pass must
confirm them before merge. Runtime commits `8aee243`, `a14f70d`, `f824381`,
`e26dba9`, `7a9243a`, and `aab9ac5` are pushed; live round-2, Codex/thread, and
CI evidence plus `716a60e`'s mutation-sensitive proof must all belong to the same final
exact head. Only Chris can record this item complete.

**Current guide:**

1. From the repository root, use the existing isolated worktree; do not switch
   or reset root `main`. Run `git -C .worktrees/ri01-synthetic-nav fetch origin`,
   `git -C .worktrees/ri01-synthetic-nav status --short --branch`,
   `git -C .worktrees/ri01-synthetic-nav rev-parse HEAD`,
   `git ls-remote origin refs/heads/fix/ri01-reject-synthetic-nav-allowances`,
   and `gh pr view 464 --json headRefOid --jq .headRefOid`. The worktree must be
   clean and all three SHAs must match. Then run `gh pr checks 464` and inspect
   the latest PR evidence comment: Build/Unit and E2E must be green on that same
   head, both independent review rounds must be clean, and no review thread may
   remain unresolved. Stop and report any mismatch instead of testing stale
   output.
2. In that worktree run `npm ci`, then `npm run build`. Keep
   `python -m http.server 5173 --bind 127.0.0.1 --directory gym` open in a second
   terminal; use the static server rather than the Vite dev server. **(Correction 2026-07-24: the imported guide justified this as avoiding the branch's "pre-#463 Vite dev server". That reason is stale — `fix/ri01-reject-synthetic-nav-allowances` pins `vite ^8.1.5` / `@crxjs/vite-plugin ^2.7.1`, identical to `main`. The static server is still the simpler choice for a Gate-3 run, so the step stands, but do NOT merge `main` into #464 on the strength of the old wording — that would invalidate the exact-head CI and 6/6 resolved threads AI-21's own step 1 requires.)** Create a temporary
   local Chrome profile, do not sign it in, and leave established profiles and
   extensions untouched. Load
   `.worktrees/ri01-synthetic-nav/extension/dist` unpacked. In NavSentinel
   Options confirm Smart mode and no localhost/127.0.0.1 allowlist entry.
3. Open `http://127.0.0.1:5173/level1-basic-opacity.html`. In page DevTools,
   confirm this returns `"1"` before testing:

   ```js
   document.documentElement.getAttribute("data-navsentinel-bridge-ready")
   ```

   If Chrome shows its self-XSS paste warning, review these exact local-only
   snippets first and follow Chrome's prompt manually; never disable the warning
   or paste unrelated code.
4. Prove a trusted click cannot lend authority to a later synthetic anchor.
   Open `level6-programmatic-click.html`, set the target to loopback in DevTools:

   ```js
   document.querySelector("#hiddenLink").href =
     `${location.origin}/level2-moving-target.html?ai21=level6`;
   ```

   Physically click **Continue**. No new tab may open and NavSentinel must show
   `Blocked new tab`. A Chrome popup-blocked badge without a NavSentinel card is
   inconclusive and must be reported.

   Reload the fixture, then hold **Ctrl** while physically clicking **Continue**
   (**Command** on macOS). The trusted modifier press must not authorize the
   page's hidden synthetic click: no new tab may open and NavSentinel must again
   show `Blocked new tab`.
5. Before the synthetic probes, open the extension service-worker inspector
   from `chrome://extensions` and run the following only in this disposable
   profile:

   ```js
   const allowanceKeys = [
     "ns_sw:gestureUntil",
     "ns_sw:allowUntil",
     "ns_sw:allowTarget"
   ];
   await chrome.storage.session.remove(allowanceKeys);
   const gymTab = (await chrome.tabs.query({
     url: "http://127.0.0.1:5173/*"
   }))[0];
   ({ gymTabId: gymTab?.id });
   ```

   Stop if `gymTabId` is missing. In that Gym page's DevTools console, execute:

   - On a fresh `level1-basic-opacity.html`, wait out the independent typed-URL
     context and stage a trusted-pointerdown-only mutation:

   ```js
   await new Promise((resolve) => setTimeout(resolve, 6000));
   const a = document.body.appendChild(document.createElement("a"));
   a.href = "http://localhost:5173/level2-moving-target.html?ai21=trusted-down";
   a.style.cssText = "position:fixed;left:-9999px;top:-9999px";
   a.addEventListener("click", (event) => console.log("synthetic click", event.isTrusted));
   const b = document.body.appendChild(document.createElement("button"));
   b.textContent = "AI-21 trusted pointerdown only";
   b.style.cssText = "position:fixed;left:0;top:0;width:180px;height:120px;z-index:2147483647";
   b.addEventListener("pointerdown", (event) => {
     console.log("trusted pointerdown", event.isTrusted);
     setTimeout(() => a.click(), 150);
   }, { once: true });
   "Physically press and hold this button; do not release until the page returns";
   ```

   Physically press and hold the button without releasing. Expect
   `trusted pointerdown true`, `synthetic click false`, and automatic rollback
   to `127.0.0.1/.../level1-basic-opacity.html`; the `localhost` destination must
   not stick. Release only after rollback. In the service-worker inspector,
   re-read `allowanceKeys` for `gymTab.id`; all three values must be `undefined`.

   - On a fresh `level1-basic-opacity.html`, validate real-Chrome frame
     provenance: a trusted pointerdown inside a child frame must preserve
     rollback without creating authority. The open inspector means this is not
     a cold-worker probe; deterministic missing-baseline and stale-after-commit
     sequencing is covered by the automated session-state tests.

   ```js
   await (async () => {
     const frame = document.body.appendChild(document.createElement("iframe"));
     frame.src = `${location.origin}/level2-moving-target.html?ai21=child-frame`;
     frame.style.cssText = "position:fixed;left:0;top:0;width:320px;height:220px;z-index:2147483647";
     await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
     const b = frame.contentDocument.body.appendChild(frame.contentDocument.createElement("button"));
     b.textContent = "AI-21 child-frame pointerdown";
     b.style.cssText = "width:260px;height:160px";
     b.addEventListener("pointerdown", (event) => {
       console.log("child pointerdown", event.isTrusted);
       top.location.href = "http://localhost:5173/level2-moving-target.html?ai21=child-top";
     }, { once: true });
     return "Physically press and hold the button inside the frame";
   })();
   ```

   Physically press and hold the frame button. Expect `child pointerdown true`
   and automatic rollback to the original `127.0.0.1` Level 1 page; the
   `localhost` destination must not stick. Release after rollback. In the
   service-worker inspector, re-read `allowanceKeys` for `gymTab.id`; all three
   values must remain `undefined`.

   - On a fresh `level1-basic-opacity.html`, prove a real pointerdown alone
     cannot authorize MAIN-world popup intent:

   ```js
   const b = document.body.appendChild(document.createElement("button"));
   b.textContent = "AI-21 pointerdown popup";
   b.style.cssText = "position:fixed;left:0;top:0;width:180px;height:120px;z-index:2147483647";
   b.addEventListener("pointerdown", (event) => {
     const w = window.open(
       `${location.origin}/level8-oauth-consent.html?ai21=pointerdown`,
       "ai21-pointerdown",
       "popup,width=520,height=640"
     );
     console.log("pointerdown popup", event.isTrusted, w === null ? "blocked" : "opened");
   }, { once: true });
   "Physically press and hold this button, then release after the console result";
   ```

   Expect `pointerdown popup true blocked`, no new tab, and NavSentinel's
   `Blocked popup` card. This call is inside genuine browser user activation,
   so Chrome's own popup blocker is not sufficient evidence.

   - On a fresh `level1-basic-opacity.html`, synthetic pointer/click ->
     `window.open`:

   ```js
   await (async () => {
     const b = document.body.appendChild(document.createElement("button"));
     b.textContent = "AI-21 synthetic open";
     const p = new PointerEvent("pointerdown", {
       bubbles: true, button: 0, ctrlKey: true
     });
     const c = new MouseEvent("click", {
       bubbles: true, cancelable: true, button: 0, ctrlKey: true
     });
     b.dispatchEvent(p);
     b.dispatchEvent(c);
     await new Promise((resolve) => setTimeout(resolve, 250));
     const w = window.open(
       `${location.origin}/level2-moving-target.html?ai21=open`,
       "_blank"
     );
     if (w) w.close();
     return {
       pointerTrusted: p.isTrusted,
       clickTrusted: c.isTrusted,
       blocked: w === null
     };
   })();
   ```

   Expect both trust flags `false`, `blocked: true`, no new tab, and
   NavSentinel's `Blocked popup` card. Chrome-only popup blocking is not a pass.

   - Reload a fresh Level 1 page, then synthetic native hidden `_blank` anchor:

   ```js
   await (async () => {
     const a = document.body.appendChild(document.createElement("a"));
     a.href = `${location.origin}/level2-moving-target.html?ai21=anchor`;
     a.target = "_blank";
     a.textContent = "AI-21 hidden anchor";
     a.style.cssText = "position:fixed;left:-9999px;top:-9999px";
     a.click();
     await new Promise((resolve) => setTimeout(resolve, 250));
     return { stayedOnLevel1: location.pathname.endsWith("level1-basic-opacity.html") };
   })();
   ```

   Expect `stayedOnLevel1: true`, no new tab, and NavSentinel's own new-tab
   block/prompt. Record the exact title if it differs.

   - Reload a fresh Level 1 page, then synthetic click -> script redirect.
     NavSentinel does **not** intercept `location.assign` (#458): Chromium's
     own unforgeable methods cannot be wrapped from a page script, so this
     probe checks the two things that are actually true — the browser refuses
     the prototype call, and a synthetic click mints no redirect allowance:

   ```js
   await (async () => {
     const startUrl = location.href;
     const b = document.body.appendChild(document.createElement("button"));
     const c = new MouseEvent("click", {
       bubbles: true, cancelable: true, button: 0
     });
     b.dispatchEvent(c);
     await new Promise((resolve) => setTimeout(resolve, 250));
     let protoCall;
     try {
       Location.prototype.assign.call(
         location,
         `${location.origin}/level2-moving-target.html?ai21=location`
       );
       protoCall = "no-error";
     } catch (error) {
       protoCall = error.name;
     }
     await new Promise((resolve) => setTimeout(resolve, 400));
     return {
       clickTrusted: c.isTrusted,
       protoCall,
       protoAssignPresent:
         Object.getOwnPropertyDescriptor(Location.prototype, "assign") !== undefined,
       ownAssignConfigurable:
         Object.getOwnPropertyDescriptor(location, "assign")?.configurable,
       stayedOnStartUrl: location.href === startUrl
     };
   })();
   ```

   Expect `clickTrusted: false`, `protoCall: "TypeError"`,
   `protoAssignPresent: false`, `ownAssignConfigurable: false`, and
   `stayedOnStartUrl: true`. A `protoAssignPresent: true` means an
   extension-installed prototype slot came back and is a failure. Do **not**
   expect a `Blocked redirect` card here — there is no pre-navigation hook on
   this path; the guarantee for script redirects is the service worker's
   post-commit rollback, exercised separately in step 5 with Level 10. After
   all three probes, run this in the service-worker inspector:

   ```js
   const allowanceState = await chrome.storage.session.get(allowanceKeys);
   Object.fromEntries(allowanceKeys.map((key) => [
     key,
     allowanceState[key]?.[String(gymTab.id)]
   ]));
   ```

   All three values must be `undefined`. Capture any different value, popup,
   navigation, prompt text, or page/service-worker console error as a failure.
6. Prove Navigation Off's explicit bypass before the positive trusted cases.
   In Options, set **Navigation** to **Off**, then reload a fresh Level 1 tab.
   In that tab's DevTools console, run:

   ```js
   (() => {
     const host = location.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
     const a = document.body.appendChild(document.createElement("a"));
     a.href = `${location.protocol}//${host}:${location.port}/level2-moving-target.html?ai21=off`;
     a.textContent = "AI-21 Navigation Off";
     a.click();
   })();
   ```

   The destination must remain loaded after six seconds, with no rollback,
   forward navigation, or NavSentinel prompt. Restore **Navigation** to
   **Smart** before continuing.
7. Prove trusted compatibility with a fresh page for each activation. At
   `level8-legit-oauth-popup.html`, physically click **Sign in**: exactly one
   OAuth popup must open with no NavSentinel prompt. Reopen the page, focus
   **Sign in** with Tab and press Enter: exactly one popup must open with no
   prompt. Repeat on `level8-legit-oauth-popup.html?input=1` using its submit
   input. Close each popup before the next case; do not use `.click()` or
   DevTools for these positive activations.
8. Close all test tabs/popups, stop the Python server with Ctrl+C, close the
   temporary Chrome profile, and remove only that deliberately disposable
   profile. Do not alter an established profile or disable security software.
9. **SUPERSEDED — see the banner at the top of this file.** Do not reply with a
   per-PR Gate-3 pass; use `AI-24 done` instead. *Original step: Reply
   `AI-21 done; Gate-3 passed on PR #464 at <40-character SHA>` with*
   Chrome's version and any console observations. On failure reply
   `AI-21 failed on PR #464 at <SHA>: <step and observed result>`. Do not merge
   on a partial pass; the agent must recheck the exact head, CI, comments, and
   merge gate afterward. AI-21 stays open until Chris explicitly confirms it.

---

## AI-22 — PR #466 pending-decision service-worker Gate-3

*Verbatim from `ACTION_ITEMS.md` on branch `fix/ri01-pending-decision-sw`.*

**🚨 OPEN: AI-22 — Run PR #466 pending-decision service-worker Gate-3 (GUIDE
PREPARED; LIVE EXACT-HEAD PRECHECK REQUIRED).** This narrow browser-surface
guide validates real Chrome `MessageSender`, active-tab/document binding,
session-store minimization, lifecycle cleanup, positive child-frame liveness,
and static module startup plus deferred broker initialization. Worker-
restart hydration remains automated-only in this narrow pass. PR #466 is a
dormant authorization boundary: it intentionally has no product producer,
popup presentation, or privileged action executor. Passing this guide therefore
does not complete RI-01, validate a real user decision flow, or authorize an
allow/trust/proceed action. The later integrated flow requires its own full
Gate-3. Only Chris can record this item complete.

**Current guide:**

1. From the repository root, use the existing isolated worktree; do not switch,
   reset, or clean root `main`. Run
   `git -C .worktrees/ri01-pending-sw fetch origin`,
   `git -C .worktrees/ri01-pending-sw status --short --branch`,
   `git -C .worktrees/ri01-pending-sw rev-parse HEAD`,
   `git ls-remote origin refs/heads/fix/ri01-pending-decision-sw`, and
   `gh pr view 466 --json headRefOid --jq .headRefOid`. The worktree must be
   clean and all three SHAs must match. Also run
   `git -C .worktrees/ri01-pending-sw merge-base --is-ancestor origin/main HEAD`;
   it must exit 0. Then run `gh pr checks 466` and inspect
   the latest PR evidence comment: Build/Unit and E2E must be green on that same
   head, both independent review rounds must be clean, and no review thread may
   remain unresolved. Stop and report any mismatch instead of testing stale
   output.
2. In that worktree run `npm ci`, then `npm run build`. Keep
   `python -m http.server 5173 --bind 127.0.0.1 --directory gym` open in a second
   terminal. Create a disposable unsigned Chrome profile, leave established
   profiles/extensions untouched, and load
   `.worktrees/ri01-pending-sw/extension/dist` unpacked. In NavSentinel Options
   select Smart mode and confirm no localhost/127.0.0.1 allowlist entry. From
   `chrome://extensions`, open NavSentinel's service-worker inspector and keep
   it open to catch any startup or first broker-initialization error.
3. Open `http://127.0.0.1:5173/level1-basic-opacity.html?ai22-source=source-secret#ai22-source-fragment`.
   In page DevTools,
   select NavSentinel's isolated content-script execution context; do not run
   this from the page's default JavaScript world. Execute the following within
   30 seconds of the later list step because pending entries expire quickly:

   ```js
   var destinationUrl =
     "http://127.0.0.1:5173/level2-moving-target.html?ai22=exact#target";
   var created = await chrome.runtime.sendMessage({
     type: "ns-pending-decision-create",
     semantics: {
       kind: "navigation",
       reason: "navigation-blocked",
       actions: ["proceed-once"],
       destinationUrl
     }
   });
   ({ created, destinationUrl });
   ```

   `created` must be exactly
   `{ok:true, operation:"create", status:"created"}` and must expose no ID,
   token, raw URL, tab/frame/document identity, or action execution. The
   service-worker inspector must show no import/startup error.
4. Right-click NavSentinel's action popup and inspect it. In that extension-page
   console run:

   ```js
   var listed = await chrome.runtime.sendMessage({
     type: "ns-pending-decision-list"
   });
   var decision = listed.decisions?.[0];
   var persisted = await chrome.storage.session.get("ns_sw:pendingDecision");
   ({ listed, decision, persisted: JSON.stringify(persisted) });
   ```

   Expect one `pending` navigation decision for the active Gym tab. The list
   response legitimately identifies the active `tabId`/`windowId`; its nested
   `decision` must contain opaque `id`/`deliveryToken`, origins, bounded
   timestamps, the declared reason and action, but no raw URL, URL hash, or
   tab/window/frame/document identity. The persisted JSON may contain origins,
   hashes, and opaque values, but must not contain `/level1-basic-opacity.html`,
   `?ai22-source=`, `#ai22-source-fragment`, `/level2-moving-target.html`,
   `?ai22=`, or `#target`.
   If the item expired, return to step 3 and create a fresh one.
5. With that same fresh decision, run this as one popup-console snippet before
   its 30-second expiry:

   ```js
   await (async () => {
     const flip = (value) =>
       value.slice(0, -1) + (value.endsWith("A") ? "B" : "A");
     const consume = (overrides = {}) => chrome.runtime.sendMessage({
       type: "ns-pending-decision-consume",
       id: decision.id,
       deliveryToken: decision.deliveryToken,
       action: "proceed-once",
       ...overrides
     });
     const wrongToken = await consume({
       deliveryToken: flip(decision.deliveryToken)
     });
     const wrongAction = await consume({ action: "allow-route" });
     const rawDestinationRejected = await consume({
       destinationUrl:
         "http://127.0.0.1:5173/level2-moving-target.html?ai22=changed#target"
     });
     const afterMismatches = await chrome.runtime.sendMessage({
       type: "ns-pending-decision-list"
     });
     const consumed = await consume();
     const replay = await consume();
     return {
       wrongToken,
       wrongAction,
       rawDestinationRejected,
       afterMismatches,
       consumed,
       replay
     };
   })();
   ```

   Expect `mismatch`, `action-not-allowed`, and `invalid-request`; consume must
   require no raw destination side channel, and the exact decision must remain
   `pending` after those denials. The exact consume must return
   `{ok:true, operation:"consume", status:"consumed", kind:"navigation",
   action:"proceed-once"}`, and replay must return `missing`. No tab navigation,
   popup, allowlist change, or other privileged action should occur because this
   slice has no executor.
6. Prove removed child frames are not listable. In the first Gym tab's default
   page world, create and wait for a same-origin child frame:

   ```js
   var ai22Frame = document.createElement("iframe");
   ai22Frame.id = "ai22-child";
   ai22Frame.src = "/level2-moving-target.html?ai22-child=1";
   var ai22Loaded = new Promise((resolve) =>
     ai22Frame.addEventListener("load", resolve, { once: true })
   );
   document.body.append(ai22Frame);
   await ai22Loaded;
   ```

   Select that child frame and NavSentinel's isolated content-script execution
   context in DevTools, then repeat step 3's create message with a fresh
   destination. Return to the top frame's default page world and run
   `document.querySelector("#ai22-child").remove()`. In the popup console, a
   fresh `ns-pending-decision-list` request must return `missing` with an empty
   array. A stale child capability must never be exposed after removal.
7. Prove active-tab and document binding using fresh entries. Create one again
   from the first Gym tab, open a second loopback Gym tab and make it active,
   then reopen/inspect the popup there: list must return `missing` with an empty
   array, never the first tab's decision. Return to the first tab, create and
   list a fresh entry, record its `listed.tabId`, then reload that exact same
   URL. Reopen/inspect the popup: list must return `missing`. Then poll the
   session store with the bounded loop below (substituting the recorded numeric
   tab ID); it must return before the timeout, proving top-navigation cleanup
   removed the replaced document rather than merely filtering its view:

   ```js
   await (async () => {
     for (let attempt = 0; attempt < 20; attempt += 1) {
       const state = await chrome.storage.session.get("ns_sw:pendingDecision");
       const byTab = state["ns_sw:pendingDecision"]?.byTab;
       if (!byTab?.[String(<recorded-tab-id>)]) return byTab;
       await new Promise((resolve) => setTimeout(resolve, 100));
     }
     throw new Error("pending-decision navigation cleanup did not finish");
   })();
   ```
8. Prove tab-removal cleanup with one final fresh entry. In the popup console,
   list it and record `listed.tabId`. In the already-open service-worker
   inspector run `await chrome.tabs.remove(<recorded-tab-id>)`, then poll:

   ```js
   await (async () => {
     for (let attempt = 0; attempt < 20; attempt += 1) {
       const state = await chrome.storage.session.get("ns_sw:pendingDecision");
       const byTab = state["ns_sw:pendingDecision"]?.byTab;
       if (!byTab?.[String(<recorded-tab-id>)]) return byTab;
       await new Promise((resolve) => setTimeout(resolve, 100));
     }
     throw new Error("pending-decision tab cleanup did not finish");
   })();
   ```

   The closed tab's key must be absent. Capture any differing response,
   unexpected persisted raw URL, extension/page console error, or unexpected
   navigation/action as a failure.
9. Close all test tabs and DevTools windows, stop the Python server with Ctrl+C,
   close the disposable Chrome profile, and remove only that deliberately
   disposable profile. Do not alter an established profile or disable security
   software.
10. **SUPERSEDED — see the banner at the top of this file.** Do not reply with a
   per-PR Gate-3 pass; use `AI-24 done` instead. *Original step: Reply
   `AI-22 done; Gate-3 passed on PR #466 at <40-character SHA>; Chrome*
   <version>` with any console observations. On failure reply `AI-22 failed on
   PR #466 at <SHA>: <step and observed result>`. Do not merge on a partial pass;
   the agent must recheck the exact head, CI, comments, and merge gate afterward.
   AI-22 stays open until Chris explicitly confirms it.
