<!-- AGENT CONTRACT: stable, tracked home for the long human Gate-3 guides.
     - `ACTION_ITEMS.md` remains the durable human-task REGISTER (what is open, who owns it).
       This file holds the long step-by-step PROCEDURES those items reference, so the register
       stays readable without pushing the guides onto mutable PR branches.
     - Only Chris can record a Gate-3 as done. Agents may refresh the pinned heads and the
       verified-state lines here when live truth changes, and must not weaken a check.
     - Every guide is precheck-gated: if step 1's exact-head equality fails, STOP and report the
       mismatch rather than proceeding. -->

# Human Gate-3 Guides — NavSentinel

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

## Index

| Item | PR | Guide |
|---|---|---|
| AI-13 | #356 MAIN-world compatibility | in [`../../ACTION_ITEMS.md`](../../ACTION_ITEMS.md) |
| AI-21 | #464 synthetic navigation | [below](#ai-21--pr-464-synthetic-navigation-gate-3) |
| AI-22 | #466 pending-decision service worker | [below](#ai-22--pr-466-pending-decision-service-worker-gate-3) |

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
