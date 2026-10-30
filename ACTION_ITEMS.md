<!-- HUMAN QUEUE: Use stable AI-N identifiers for human decisions or manual checks.
     Close an item only from an explicit owner answer or directly verified removal
     of the action it requested. -->

# ACTION ITEMS — Human-Owned Tasks (NavSentinel)

**Purpose:** the concise, durable register for human decisions and manual checks.
It is not a live GitHub snapshot: re-check Git, GitHub, and product checks before
acting. `docs/Project_Roadmap.md` holds execution work; archive material is
provenance only. Detailed retired procedures moved to
[`docs/archive/ACTION_ITEMS_HISTORY_2026-08-12.md`](docs/archive/ACTION_ITEMS_HISTORY_2026-08-12.md).

## Current snapshot

**2026-09-27 ([`D-2026-09-27-S`](docs/agentic/DECISIONS.md)):** Chris waived the
AI-47 manual Chrome pass on the agent evidence in
[`docs/testing/AI47_V050_AGENT_PASS_2026-09-26.md`](docs/testing/AI47_V050_AGENT_PASS_2026-09-26.md).
It is recorded as "manual gate waived on agent evidence", not "Gate-3 passed".
A browser-facing PR now passes the acceptance lane if it adds no new failures
relative to `main` and each known red has an open issue (#865 today). Row 8 is
being redesigned (#947), v0.5.1 waits for more fixes, and AI-19 takes the rename
route.

**2026-09-25, v0.5.0 integration ([`D-2026-09-25-Q`](docs/agentic/DECISIONS.md)):**
Chris authorized browser-facing PRs to merge after automated gates (exact-head
CI, one review, and the branded-Chrome realistic E2E and acceptance lanes). His
manual checks become one AI-47 pass on the v0.5.0 release build, published on
2026-09-26 as a GitHub pre-release (tag `v0.5.0`, commit
`15a81274b2b7db4d61a0be43a8f8149110add8e6`). He also resolved #872: the same-tab rollback
notice keeps its trusted-input Proceed. #572 (SP-F-013) stays parked, and every
AI-47 Human result stays **OPEN — not run**.

**2026-09-25, second batch ([`D-2026-09-25-R`](docs/agentic/DECISIONS.md)):**
Chris accepted AI-37: #599's unverified-window clipboard coalescing may merge on
the same automated gates, and its Chrome check joins AI-47. He deferred AI-19
until the store submission and approved the two AI-23 retirements, which are
now done. Items that need only his acknowledgement, not a decision, are listed
under "Owner acknowledgement list" below.

**Browser-gate index refreshed 2026-09-12 from merge receipts:** Chris explicitly
authorized the named browser-gated candidates to merge before manual Chrome
testing under [`D-2026-09-12-P`](docs/agentic/DECISIONS.md), provided every
non-human gate still passes. The retained browser work is consolidated as AI-47
below. A merge, CI, or automated Chromium result is not a human-test result;
every AI-47 Human result was **OPEN — not run** until Chris waived the pass on
agent evidence on 2026-09-27 (D-2026-09-27-S). Browser merge receipts cover #600,
#609, #636, #640, #641, #643, #644, #649, #657, #608, #655, and #658. PR #658
merged as `8a9435349e0dcdbe834bfee2beeeccafd5b39ccf`; its child result was
waived with AI-47 on 2026-09-27 (D-2026-09-27-S). PR #599 stayed outside until AI-37 was accepted on
2026-09-25 (D-2026-09-25-R), and PR #572 remains parked outside on SP-F-013. PR #687
merged as `63e3bbbc401f272e88abc88a4f890ba4003bdb1f`, but remains a test-only
delayed-clipboard lane: its evidence is `MODELLED`/`UNVERIFIED`, not owner
Chrome evidence or OS-paste prevention. This is not the total open-PR count or
a claim that any pending candidate has completed every required review or gate.
AI-30, AI-33, AI-35, and AI-36 are now
**post-merge** checks: PRs #570, #582, #586, and #589 merged on 2026-08-27 and no
waiver record for those merges was found in `docs/agentic/DECISIONS.md`,
`HANDOFF.md`, this file, or `docs/Project_Roadmap.md`, so each check stays open
against current `main`. The earlier explicitly waived browser-surface PRs (#528,
#532, #535, #514, #534, #520, #521, #522, #526, #533, #542, and separately #531)
merged after refreshed exact-head CI and bounded review; that waiver is not a
real-Chrome pass and establishes no `measure:fp` or headed-measurement result,
and #223 remains open. AI-27, AI-28, and AI-29 are resolved; AI-14 remains
blocked for future measurement work.

PR #600 merged as `c8b1a70bef3c92600fdf7af3fb9fdc5e73b236f2` under the
one-time waiver. Its Chrome work is now a current-`main` AI-47 subprocedure,
not a branch-held item or a human-test pass.

PR #609 merged as `e35f5430660767d4998c8f4d727b38444f3f9b14` under the same
waiver. Its Back/Forward Cache Chrome work is now a current-`main` AI-47
subprocedure, not a branch-held item or a human-test pass.

**Guided resolution cursor:** `AI-19` (`Resume at: AI-19`). Current ready order:
AI-19 (Heedline chosen; formal clearance, repository name and store listing remain) → optional AI-24. AI-47 was
waived on agent evidence on 2026-09-27 (D-2026-09-27-S), including its attached
#649 child-form, #655 imported-log-limit and #658 conditional-write checks.
AI-23 was resolved on 2026-09-25.
The four older post-merge checks (AI-30, AI-33, AI-35,
AI-36) are unordered additions to that queue.

**Status vocabulary note:** issue #421's proposed `OPEN | HELD | BLOCKED` parser
enum was superseded by owner decision #499 (2026-07-31), which removed the
repository-local harness, its ACTION_ITEMS/HANDOFF parser, hooks, and CI. Do not
reintroduce parser, status-enum, hook, tier, or harness machinery through this
register.

## Recently resolved item detail

**RESOLVED: AI-29 - Issue #555 opt-in overlay-cleanup Gate-3.** On 2026-08-28,
Chris loaded PR #557's exact `ee804fa8d45f34284e073b7054cdc558b14b025d`
artifact, reported that overlay cleanup works as intended, accepted the remaining
regular redirect-card control regression, and explicitly authorized merge. The
Chrome version was not supplied. **Dismiss** and **Allow once** on an ordinary
redirect guard may remain visibly present but inert; this is a fail-closed UX and
accessibility regression, not an established navigation bypass, and is tracked
with the complete evidence boundary and repair oracle in #560. The historical
attempt records below are retained as at-the-time evidence and do not reopen the
completed gate. This PR-specific completion does not change today's AI-19
guided cursor.

**Earlier human result (2026-08-27, PR #557 at
`14e397b154f50b5ea8e1e30ca211404e8cf34bca`): FAILED at step 5.** In a fresh
Chrome profile, Chris confirmed the setting survives save/reopen and works by
keyboard; mutation-01 is hidden when cleanup is enabled and Undo works;
Navigation Off leaves cleanup inert; and the legitimate modal/video fixtures
remain usable. On `evasion-02-size-34pct.html`, NavSentinel blocked the new tab
but did not hide the deceptive overlay or expose the expected cleanup Undo.
Console status was not reported. Keep AI-29 open until the real-Chrome mismatch
is fixed and the new exact head passes the active procedure.

**Latest human result (2026-08-27, PR #557 at
`e8f5fafc9270a54acc510909cf670b1610cab55e`): FAILED the clarified automatic
cleanup outcome.** After rebuilding/reloading the unpacked extension in the
fresh profile, the popup showed cleanup enabled but the initial pink
`evasion-02-size-34pct.html` trap remained over **Real Link** until Chris clicked
it. The click-time fallback then correctly blocked `evil.example.com`, hid the
trap, and showed `Blocked new tab (overlay hidden)` with Undo. This proves the
reactive repair but not the requested pre-click behavior. Keep AI-29 open until a
new exact head hides the settled initial trap before interaction and passes the
revised active guide.

**Subsequent exploratory real-world finding (2026-08-27):** a media embed used a
non-qualifying outer iframe (`z-index:auto`) around a fixed maximum-z-index iframe
attached directly below the child document's `<html>`; the innermost static
`#container` disappeared when hidden manually. The prior top-frame-only automatic
monitor could not reach the qualifying middle node. The current candidate adds
bounded opt-in child-frame monitoring, direct-`<html>` discovery, isolated-world
self-UI exclusion, and an exact synthetic plus twelve-frame stress matrix. This is
automated candidate evidence, not a human Gate-3 completion; keep AI-29 open.

**Earlier human result (2026-08-27, PR #557 at
`f17dae0d9ad0573d73140784b76e377c2667c7eb`): FAILED on persistent real-world
cleanup.** Across four visible media embeds, cleanup was inconsistent after
reload and scroll. Direct inspection of one initialized child frame showed the
first layer become hidden at about 0.3 seconds, then a page rewrite/replacement
made both a full-player layer and a maximum-z-index child iframe visible again at
about 2 seconds; they stayed visible for the remaining 15-second observation
while the success card remained. Clicking NavSentinel's own **Dismiss** also
reached a page-level click handler and produced a blocked-popup notice. This
invalidates the prior E2E oracle, which stopped at the first hidden sample. The
subsequent repair uses an independently bounded, persistent cleanup lane, retains
one grouped Undo across replacement and independently delayed layers, and records
local cleanup outcomes. Its hostile fixture first failed on the old head and now
stays hidden across alert flooding, style rewrite, node replacement, and scroll
reinsertion.

**Latest human result (2026-08-27, PR #557 at
`661f97f2d164535686e8650b8ec09434bf8b08ba`): CORE PERSISTENCE PASSED; Gate-3
step 8 still FAILED.** After loading the correct build, Chris reported that the
real multi-embed page worked flawlessly across the prior recurrence paths and
accepted the suppression behavior. Clicking NavSentinel's **Dismiss**, however,
still reached the hostile child frame and briefly produced another blocked-click
notice. A stronger capture-phase fixture reproduces the escape against that head.
The current local repair candidate installs the toast input fence synchronously
before the MAIN bundle's asynchronous import and has red-to-green mouse Dismiss
and keyboard Undo coverage with every page input counter held at zero. This is
automated candidate evidence
only. Keep AI-29 open until the pushed exact head has green hosted CI and Chris
repeats the exact-head guide.

**Latest human result (2026-08-28, PR #557 at
`848d613ec74b9a1d1b9e026163f06585e9fc23d2`): FAILED the repaired control
action.** The overlay remained suppressed and the document-start fence stopped
the hostile-frame reaction, but both **Dismiss** and **Undo** became inert with
no corresponding console error. Read-only inspection of the live child frame
confirmed that the controls were enabled and held valid action tokens while the
verified MAIN-to-isolated bridge was otherwise active. A red synthetic case now
retargets the realm-visible event path to the extension host and reproduces the
inert Dismiss. It also replaces page-realm mouse-coordinate and keyboard-key
accessors; the prior candidate consulted the poisoned mouse fields four times.
The current local candidate captures the required event, traversal, focus, list,
and geometry accessors at document start, uses the pristine path only to prove
host ownership, and resolves the owned control without consulting the poisoned
page accessors before relaying the same bounded token. This is automated candidate
evidence only. Keep AI-29 open until the pushed exact head has green hosted CI
and Chris repeats the exact-head guide.

**Latest human result (2026-08-28, PR #557 at
`c388c40fb8b7237f04c2d94295f3e0bc80d64e3a`): FAILED in the owner-loaded
real-world child frame.** Cleanup remained active, but trusted mouse and keyboard
activation left Dismiss and Undo visibly present and inert, with no corresponding
console exception. Read-only inspection confirmed enabled tokenized controls and
an initialized bridge. Differential build inspection then found that post-build
guard bytes had changed while the manifest retained the same Vite-generated
loader URL, which gives a long-lived unpacked Chrome profile no new resource
identity for the repaired guard even though fresh-profile Playwright reads the
current disk bytes. The current candidate content-addresses the loader after
post-processing, verifies that identity as a named CI contract, and requires a
new runtime guard revision in every relevant Playwright page/frame. This is
automated candidate evidence only. Keep AI-29 open until the pushed exact head
has green hosted CI and Chris owner-reloads that exact artifact and repeats the
control checks.

**Final owner result (2026-08-28, PR #557 at
`ee804fa8d45f34284e073b7054cdc558b14b025d`): PASSED with one accepted tracked
regression.** Owner testing accepted the
remaining rotating-site limitation but found one large Undo/Dismiss card per
media frame too obstructive. Overlay-cleanup recovery is now a small Undo-only
status that leaves after 2 seconds or the next trusted outside pointer
interaction; redirect and security prompts are unchanged. Synthetic Chrome
coverage proves the outside interaction still reaches the page, expiry does not
restore the attack, twelve mixed frames shed their notices, and a preserved
accessible player-error dialog becomes usable after the brief overlap. #593
tracks the non-reproducible hidden-media redirect observation and #594 tracks
any future high-confidence nuisance-dialog handling. Chris confirmed this exact
artifact works as intended and authorized merge. A regular redirect guard's
**Dismiss** and **Allow once** controls may be inert; Chris accepted that
fail-closed regression for this merge, and #560 now owns its combined hostile-
frame reproduction and repair.

## Open and blocked items

### Open owner decisions (agent-hq inbox)

Answer these in the estate cockpit or in chat. Each record is `agent-hq/decisions/<id>.json`.

- **`navsentinel-main-guard-budget-20261023`**: raise the `main_guard` (MAIN-world) perf budget so
  #1141's captured-natives fix and #1065 (captured `closest`) can land? Both stay open until it is answered;
  #1155 (#1134) landed within the cap at 21,481 of 21,504 bytes, leaving its `ownerDocument` check (`test.fixme`)
  for after the decision.
- **`navsentinel-dist-budget-20261030`**: raise the `capture_isolated` (67 -> 69 KB) and `credential_guard`
  (31.5 -> 32.5 KB) caps so queued isolated-world detections can land? Waiting on it: #1183 (fullscreen-locker
  exit, reverted by #1194 after it and #1152 together overran the research-profile capture cap), #1182, #1195,
  and the #1142/#1149/#1189 follow-ups.

### Retroactive Gate-3 checks (AI-48 onward)

Standing rule since 2026-10-26 (D-2026-10-26-A): every browser-facing PR lands on automated gates and gets a row here.
Owner decision 2026-10-16: "add them to checks to be done retroactively". These PRs no longer wait for
Gate-3. Each lands on green CI, one independent review and the credential_guard bundle cap
(`scripts/check-perf-budget.mjs`), and Chris runs its branded-Chrome check afterwards on the merged build. A
failure gets a revert PR for that merge commit. Build the merge commit (`npm ci`, `npm run build`), load
`extension/dist` unpacked, and reply `AI-xx done; Gate-3 passed at <merge commit>` or describe what differed.
PR #1072 (AI-52, CRXJS 3) joined on 2026-10-24, once its Windows contracts passed on a fresh run; the
earlier red was the #1143 Git-test timeout, fixed by #1146.

| AI | PR | Merged head | Human result |
| --- | --- | --- | --- |
| AI-48 | #1100 credential resubmit retarget | `598b94c8` (merged 2026-10-16) | OPEN — not run |
| AI-50 | #1103 retarget into other windows | `2c7a232c` (merged 2026-10-16) | OPEN — not run |
| AI-49 | #1098 popup-name text bound | merge commit `dce69fe3` (merged 2026-10-16) | OPEN — not run |
| AI-51 | #1104 credential snapshot bound | merge commit `fbe7648a` (merged 2026-10-17) | OPEN — not run |
| AI-53 | #1077 popup trust after failed writes | merge commit `aa39a7b2` (merged 2026-10-16) | OPEN — not run |
| AI-54 | #1106 guards through `document.open()` | merge commit `d2cbf115` (merged 2026-10-16) | OPEN — not run |
| AI-55 | #1017 opener `location` facade (MAIN world) | merge commit `c47c5991` (merged 2026-10-18) | OPEN — not run |
| AI-56 | #1060 subframe form-target capture (MAIN world) | merge commit `a0035874` (merged 2026-10-18) | OPEN — not run |
| AI-52 | #1072 CRXJS 3 build pipeline | merge commit `44d8875a` (merged 2026-10-24) | OPEN — not run |
| AI-57 | #1163 Protection Center retained activity | [PR merge receipt](https://github.com/Chris0Jeky/NavSentinel/pull/1163) (candidate until merged) | OPEN — not run |
| AI-58 | #1165 journal reading continuity | [PR merge receipt](https://github.com/Chris0Jeky/NavSentinel/pull/1165) (candidate until merged) | OPEN — not run |
| AI-59 | #1166 ClickFix clipboard hooks on prototypes (MAIN world) | [PR merge receipt](https://github.com/Chris0Jeky/NavSentinel/pull/1180) (candidate until merged) | OPEN — not run |
| AI-67 | #1184 Options recorded-choices labels and export omission notice | [PR merge receipt](https://github.com/Chris0Jeky/NavSentinel/pull/1184) (candidate until merged) | OPEN — not run |
| AI-60 | #1140 visible, armed credential and toast approvals (#1139) | merge commit `a75986b9` (merged 2026-10-30) | OPEN — not run |
| AI-61 | #1155 main_guard and its bridge in about:blank/srcdoc/blob frames (#1134, MAIN world) | merge commit `e96cc756` (merged 2026-10-30) | OPEN — not run |
| AI-62 | #1187 credential backstop after `document.open()` (#1113) | merge commit `2f28d476` (merged 2026-10-30) | OPEN — not run |
| AI-63 | #1152 overlay cleanup: deep and shadow-root foreground traps (#564, opt-in) | merge commit `2b6523af` (merged 2026-10-30) | OPEN — not run |
| AI-66 | #1183 tech-support-scam fullscreen locker exit, re-landed by #1210 | [PR merge receipt](https://github.com/Chris0Jeky/NavSentinel/pull/1210) (candidate until merged) | OPEN — not run |
| AI-68 | #1199 credential risk decodes punycode labels (homograph lookalikes, #1196) | merge commit `025b9dc2` (merged 2026-10-30) | OPEN — not run |
| AI-69 | #1204 reverse-tabnabbing warning when another tab swapped a hidden page (#1172) | merge commit `3ff1417e` (merged 2026-10-30) | OPEN — not run |
| AI-70 | #1211 reverse-tabnabbing warning for openers under popup windows (#1205) | merge commit `177b7ace` (merged 2026-10-30) | OPEN — not run |
| AI-80 | #1216 ConsentFix: a pasted or dropped localhost sign-in URL with an OAuth code is stopped (and first-party redirect codes, this PR) | merge commit `f80e3a67` (merged 2026-10-30) | OPEN — not run |
| AI-81 | #1222 device-code phishing warning on Microsoft, Google and GitHub device sign-in pages | merge commit `9641f9ef` (merged 2026-10-30) | OPEN — not run |
| AI-82 | #1224 masked and type-flipped password fields count as password fields for the credential prompt | merge commit `9d3e804e` (merged 2026-10-30) | OPEN — not run |
| AI-83 | #1233 ClickFix reads lure text in open shadow roots and rescans late instructions | merge commit `f415ae13` (merged 2026-10-30) | OPEN — not run |
| AI-84 | #1240 device-code phishing, lure side: warning when a page copies a code next to a device sign-in address | merge commit `51f9a302` (merged 2026-10-30) | OPEN — not run |
| AI-97 | #1245 late ClickFix detection neutralizes the clipboard only when no newer copy happened | merge commit `3d53539d` (merged 2026-10-30) | OPEN — not run |
| AI-98 | #1247 warning when Microsoft's sign-in form is served by a non-Microsoft host (AiTM relays and clones) | merge commit `fcc92793` (merged 2026-10-30) | OPEN — not run |
| AI-85 | #1202 protection toast in a closed shadow root (#1142 item 4) | merge commit `737bcdb6` (merged 2026-10-30) | OPEN — not run |
| AI-86 | #1206 lazy-loaded overlay cleanup and credential content analyzer | merge commit `7f48c229` (merged 2026-10-30) | OPEN — not run |
| AI-87 | #1195 password-focus warning on high-risk pages (#1170) | merge commit `0d64e7ef` (merged 2026-10-30) | OPEN — not run |
| AI-88 | #1182 ClickFix without an overlay, Win+X/FileFix variants, pastejacking (#1167, #1168) | merge commit `59398141` (merged 2026-10-30) | OPEN — not run |
| AI-89 | #1191 hijacked clipboard replaced with a warning on high-confidence ClickFix (#1169) | merge commit `1b6c9421` (merged 2026-10-30) | OPEN — not run |
| AI-90 | #1065 popup-intent ancestors read through the document-start `closest` (MAIN world) | merge commit `10e1b98a` (merged 2026-10-30) | OPEN — not run |
| AI-91 | #1214 approvals gated on IntersectionObserver v2 painted visibility (#1142 items 1-3) | merge commit `06a0f45e` (merged 2026-10-30) | OPEN — not run |
| AI-92 | #1231 approvals require window focus, generic fonts, toast clicks pinned to the press | merge commit `9ab71eb2` (merged 2026-10-30) | OPEN — not run |
| AI-93 | #1237 pending off-site meta refresh scored on credential pages (#1144) | merge commit `5229650a` (merged 2026-10-30) | OPEN — not run |
| AI-94 | #1238 approvals refused under PiP and after short blurs; per-load subframe focus latch (#1236) | merge commit `8a866350` (merged 2026-10-30) | OPEN — not run |
| AI-95 | #1243 loader-level blur/focus fence and tab-wide PiP relay (#1242) | merge commit `a6fff55d` (merged 2026-10-30) | OPEN — not run |
| AI-96 | #1141 MAIN-world bridge and guards use natives captured at document start | merge commit `4d0b1dc4` (merged 2026-10-30) | OPEN — not run |
| AI-100 | #1249 every frame asked for Picture-in-Picture state (hostile frames, blob and sandboxed frames, removed frames; #1244) | merge commit `ba17e96c` (merged 2026-10-30) | OPEN — not run |
| AI-101 | #1252 meta-refresh credential signal fails closed on overflowing or cut refresh tags (#1241) | [PR merge receipt](https://github.com/Chris0Jeky/NavSentinel/pull/1252) (candidate until merged) | OPEN — not run |
| AI-102 | #1246 and #1255 built pages without indentation, recompressed icons, compact manifest | merge commits `cc1700bc` and `2053f883` (merged 2026-10-30) | OPEN — not run |

Checks, all in branded Chrome on the unpacked build of the merged head:

- **AI-60 (#1140):** follow [`ISSUE_1139_VISIBLE_APPROVALS_2026-10-22.md`](docs/testing/ISSUE_1139_VISIBLE_APPROVALS_2026-10-22.md).
  (1) A normal credential prompt's Proceed once and a toast's Trust or Allow once still work by mouse and by
  Enter/Space once the prompt has been visible for 800 ms. (2) On a local page, hide the prompt host
  `#__sentinelsuite_cred_modal_host__` with `opacity: 0 !important` (as `tests/e2e/credential-modal-visibility.spec.ts`
  does): a click on the hidden Proceed once is refused and the decision stays pending; Cancel and Escape still
  work. After restoring visibility, approvals arm again only after 800 ms. A failure gets a revert PR for `a75986b9`.

- **AI-61 (#1155):** the PR body's "Gate-3 check for the owner" procedure (an about:blank and a srcdoc probe
  frame must not navigate the top page without the guard). Also browse a few ordinary pages with about:blank ad or
  editor frames and watch for new toasts, prompts or broken clicks. A failure gets a revert PR for `e96cc756`.

- **AI-62 (#1187):** on a local page with dummy credentials: (1) a normal login form still submits after Proceed
  once, with one POST; (2) a page that rewrites itself with `document.open()` and writes a capturing submit
  listener that stops the event still gets the credential prompt, and Cancel sends nothing; (3) a search form in
  a page's own web component still submits. A failure gets a revert PR for `2f28d476`.

- **AI-63 (#1152):** with automatic overlay cleanup turned on in Options, serve the Gym (`npm run gym:serve`) and
  open `http://localhost:5173/overlay-nesting-lab.html?case=deep-static` and `?case=shadow-static`: the pre-existing deep and shadow-root
  traps are hidden on load with an Undo card. Open `?case=deep-benign`: the slotted dialog panel stays visible. Then check a fullscreen video and a page with a cookie banner stay usable
  (residual risks are tracked in #1189). A failure gets a revert PR for `2b6523af`.

- **AI-68 (#1199):** dummy credentials only. (a) Serve the Gym without a host check:
  `py -m http.server 8080 --directory gym`. (b) Quit Chrome fully (no background processes), relaunch the
  profile that has the unpacked build with
  `--host-resolver-rules="MAP xn--pypal-4ve.com 127.0.0.1, MAP xn--mller-kva.de 127.0.0.1, MAP xn--wgv71a.jp 127.0.0.1"`,
  and confirm Heedline is still loaded. (1) Type the full URL `http://xn--pypal-4ve.com:8080/content-fp-03-legit-login.html`,
  enter a dummy password and submit: the prompt lists a mixed-alphabet reason ("mixes scripts") and a brand
  look-alike ("spoofing brand paypal"); with `paypal.com` in Trusted domains it also lists "similar to trusted
  domain". Cancel. (2) Do the same on `http://xn--mller-kva.de:8080/...` and `http://xn--wgv71a.jp:8080/...`:
  "Hostname contains punycode (xn--)" and the plain-HTTP and untrusted-site lines are expected for every xn--
  host and are not a failure; a failure is any "mixes scripts", "similar to trusted domain" or "spoofing brand"
  line on these two. Afterwards remove `paypal.com` from Trusted domains if you added it and relaunch Chrome
  normally. A failure gets a revert PR for `025b9dc2`.

- **AI-69 (#1204):** with the Gym served (`npm run gym:serve`): (1) in tab A open `http://localhost:5173/`, run
  `window.open("http://localhost:5173/")` in its DevTools (a new tab, not a popup window; tab A must stay in the
  background), and in the new tab's DevTools run `opener.location = "http://127.0.0.1:5173/"` (a different
  hostname; a different port alone is the same site and stays silent by design); return to tab A: a toast says
  another tab changed this page and names `localhost`. (2) Navigate tab A back to `http://localhost:5173/`
  (step 1 left it on 127.0.0.1), close the old child tab, open a new one the same way and run
  `opener.location = "http://localhost:5173/?same-site"`; return to tab A: no toast. (3) Open
  `http://localhost:5173/level8-legit-oauth-popup.html` and complete its sign-in popup: no toast. A failure gets a
  revert PR for `3ff1417e`.

- **AI-70 (#1211):** as AI-69 step (1), but open the child as a popup window:
  `window.open("http://localhost:5173/", "_blank", "popup,width=600,height=500")`. With the popup in front, run
  `opener.location = "http://127.0.0.1:5173/"` in its DevTools and wait for tab A to finish loading behind it: no
  toast yet. Click back into tab A's window (or close the popup): the toast appears once. A failure gets a revert PR
  for `177b7ace`.

- **AI-67 (#1184):** copy-only check. (1) Options > Recorded choices shows the retained sample, cap and time span
  and no "Threat Analytics" wording; (2) in the Protection Center, with a credential warning in fictional history,
  Export shows "... include explanations that are not part of the portable export." and the downloaded file
  matches the preview. A failure gets a revert PR for the merge commit.

- **AI-83 (#1233):** with the Gym served (`npm run gym:serve`), open `http://localhost:5173/clickfix-04-winr.html` and
  click its fake verification: the ClickFix warning still appears. Then on `http://localhost:5173/rw-fullscreen-benign.html`
  run in DevTools (a page must have focus to write the clipboard, so the line waits 3 s while you click the page)
  `setTimeout(() => { navigator.clipboard.writeText("NAVSENTINEL_SENTINEL_DO_NOT_RUN base64"); setTimeout(() => { const h = document.createElement("div"); h.attachShadow({ mode: "open" }).innerHTML = "<p>Verify you are human: press Win + R, paste and press Enter.</p>"; document.body.append(h); }, 1000); }, 3000)`
  and click the page: the warning appears within about two seconds of the text. A docs page's copy button (any code
  sample) stays quiet. A failure gets a revert PR for `f415ae13`.

- **AI-84 (#1240):** do not enter any code anywhere. On `http://localhost:5173/rw-fullscreen-benign.html` run in
  DevTools `setTimeout(() => navigator.clipboard.writeText("ORDER-1234"), 3000)` and click the page: no warning.
  Then run `document.body.append("open microsoft.com/devicelogin and enter the code below")` and
  `setTimeout(() => navigator.clipboard.writeText("ABCD-1234"), 3000)`, and click the page: a warning says the page
  copied a code for a device sign-in page. On `https://learn.microsoft.com/` the same lines stay quiet. A failure gets
  a revert PR for the merge.

- **AI-85 (#1202):** with the Gym served (`npm run gym:serve`), trigger any protection toast (for example a Gym
  popup scenario). The toast looks and behaves as before (Trust, Allow once, Dismiss by mouse and keyboard), and in
  the page's DevTools the toast host's `shadowRoot` reads `null`. Automated: `toast-button-click-contract.spec.ts`,
  `toast-state-reader.spec.ts`. A failure gets a revert PR for `737bcdb6`.

- **AI-86 (#1206):** (1) with automatic overlay cleanup on in Options, a Gym overlay-trap page still gets its
  cleanup chip and the trap is removed; (2) a credential prompt on a risky Gym login page still shows its content
  reasons. The service-worker console shows no failed `import()` of `overlay_cleanup` or `content_analyzer`.
  Automated: `phase2-detections.spec.ts`. A failure gets a revert PR for `7f48c229`.

- **AI-87 (#1195):** dummy credentials only. On the Gym's `fetch-login-phish.html`, focusing the password field
  shows the warning before anything is typed; `fetch-login-benign.html` stays quiet. Automated:
  `credential-focus-warning.spec.ts`. A failure gets a revert PR for `0d64e7ef`.

- **AI-88 (#1182):** on `http://localhost:5173/rw-fullscreen-benign.html`, appending a "press Win + X, then paste"
  instruction with no overlay shows the ClickFix warning; a page whose copy listener swaps a copied selection for a
  command (pastejacking) is flagged when you copy. A docs page's ordinary copy button stays quiet. Automated:
  `pastejacking-copy-listener.spec.ts`. A failure gets a revert PR for `59398141`.

- **AI-89 (#1191):** in Smart or Strict mode, a high-confidence ClickFix lure that writes a command to the clipboard
  shows the ClickFix warning and then a second toast saying the command was replaced; pasting into Notepad gives
  Heedline's warning sentence, not the command. If the write is rejected, only the first warning shows. Automated:
  `phase2-detections.spec.ts`. A failure gets a revert PR for `1b6c9421`.

- **AI-90 (#1065, MAIN world):** popup-intent detection still treats a click inside a link or button as the user's
  intent: a Gym popup scenario opened by a real click is allowed, and the deceptive one is still caught. Automated:
  `main-native-call-capture.spec.ts`. A failure gets a revert PR for `10e1b98a`.

- **AI-91 (#1214):** a normal credential prompt and toast arm and accept clicks as before, including while hovered.
  In DevTools, paint a click-through cover over Proceed once:
  `const c = document.createElement("div"); c.popover = "manual"; c.style.cssText = "position:fixed;inset:0;margin:0;pointer-events:none;background:#fff"; document.body.append(c); c.showPopover()`.
  A click where Proceed once sits (under the white cover) then does nothing (the decision stays pending); after `c.remove()` it arms again. A prompt inside a cross-site iframe still works.
  Automated: `credential-modal-visibility.spec.ts`, `credential-modal-hover.spec.ts`,
  `credential-modal-iframe.spec.ts`. A failure gets a revert PR for `06a0f45e`.

- **AI-92 (#1231):** the credential prompt and toast render in the system sans-serif font even on a page whose CSS
  restyles `font-family` broadly; approvals do nothing while another window has focus and work once the page window
  is focused again; on a toast, pressing on one button and releasing on another does not activate the second.
  Automated: `approval-surface-fonts.spec.ts`, `credential-modal-focus.spec.ts`, `toast-press-pin.spec.ts`. A
  failure gets a revert PR for `9ab71eb2`.

- **AI-93 (#1237):** dummy credentials only. On the Gym's `meta-refresh-offsite.html`, submitting the login form
  while an off-site meta refresh is pending shows the credential prompt with the refresh reason;
  `meta-refresh-samesite.html` does not. Automated: `meta-refresh-credential.spec.ts`. A failure gets a revert PR
  for `5229650a`.

- **AI-94 (#1238):** while a video on the page is in picture-in-picture, the credential prompt's Proceed once does
  nothing; once PiP closes it arms again after the usual short delay. Switching away from the window and straight back makes
  approvals wait briefly before arming. Automated: `credential-modal-covers.spec.ts`. A failure gets a revert PR for
  `8a866350`.

- **AI-95 (#1243):** as AI-94, but put a video inside a same-site iframe into picture-in-picture: Proceed once in the
  top-frame prompt does nothing until that PiP window closes. Running `window.dispatchEvent(new Event("pagehide"))`
  in DevTools while PiP is open does not re-arm it. Automated: `credential-modal-covers.spec.ts`. A failure gets a
  revert PR for the merge.

- **AI-96 (#1141, MAIN world):** automated evidence covers the hostile cases (`main-world-clock-early-inline.spec.ts`,
  `bridge-peer-takeover.spec.ts`, `blocked-action-id-authority.spec.ts`, the `form-submit-*` specs). By hand, a
  regression smoke only: with the Gym served, the deceptive-popup and credential-submit scenarios still warn as before,
  a real-click popup still opens, and the page console shows no `[NavSentinel]` errors. A failure gets a revert PR
  for the merge.

- **AI-100 (#1249):** as AI-95, plus: with a credential prompt open on a local page, add a sandboxed frame from
  DevTools (no network: the video is a canvas stream):

  ```js
  const f = document.createElement("iframe"); f.sandbox = "allow-scripts"; f.src = URL.createObjectURL(new Blob([`<button id=pip>PiP</button><script>const v = document.createElement("video"); v.muted = true; const c = document.createElement("canvas"); c.getContext("2d").fillRect(0, 0, 160, 90); v.srcObject = c.captureStream(); v.play(); pip.onclick = () => v.requestPictureInPicture();<\/script>`], { type: "text/html" })); document.body.append(f);
  ```

  Click the frame's PiP button: Proceed once does nothing and the prompt says to close Picture-in-Picture; it works
  again shortly after PiP closes. Automated: `credential-modal-covers.spec.ts`. A failure gets a revert PR for
  `ba17e96c`.

- **AI-101 (#1252):** dummy credentials only. On a local login page with a password field, add from DevTools
  `const m = document.createElement("meta"); m.httpEquiv = "refresh"; m.content = "300;" + " ".repeat(2100) + "url=//example.org/"; document.head.append(m)`
  and submit: the credential prompt lists "Page refresh tags are too many or too long to check". A normal page with
  one short same-site refresh shows no refresh reason. Automated: `content-analyzer-meta-refresh.test.ts`. A failure
  gets a revert PR for the merge.

- **AI-102 (#1246, #1255):** open the popup, Options, the onboarding page and the Protection Center (evidence page)
  in light and dark themes: text spacing, inline links and buttons look as before; the toolbar and
  `chrome://extensions` icons are sharp and unchanged; the extension loads with no manifest error. A failure gets a
  revert PR for the merge in question.

- **AI-97 (#1245):** with the Gym served (`npm run gym:serve`), on `http://localhost:5173/rw-fullscreen-benign.html`
  run the AI-83 DevTools line (a delayed inert command copy, then the shadow-root lure a second later) and click the
  page: after the warning appears, paste into a text box: the clipboard now holds Heedline's warning text, not the
  command. Repeat, but after clicking the page select some page text and press Ctrl+C before the lure appears: the
  warning still shows and your own copied text survives. A failure gets a revert PR for `3d53539d`.

- **AI-98 (#1247):** dummy credentials only. On any https page you control (or a local page mapped to a public-looking
  host), add `<input type="password" id="i0118" name="passwd">` and click into it: a warning says Microsoft's sign-in
  form is served by that host. The same field on `https://login.microsoftonline.com/` (the real sign-in, password
  step) shows nothing, and an ordinary site's password field shows nothing. A failure gets a revert PR for `fcc92793`.

- **AI-80 (#1216):** nothing typed or pasted here is real. On a public page with a plain text box (for example
  the search box on `https://www.wikipedia.org/`, without pressing Enter) paste
  `http://localhost:8400/?code=0.AXoAexampleexample&state=x`: a warning card appears and the box stays empty;
  pasting again is still stopped; after clicking the card's "Allow once (I meant to)" the next paste goes in. Then
  paste `https://insiders.vscode.dev/redirect?code=0.AXoAexample` into the same box: stopped the same way. Pasting
  ordinary text is untouched. A failure gets a revert PR for `f80e3a67` (and for this PR's merge).

- **AI-81 (#1222):** do not enter any code. (1) Open `https://example.com/` and in its DevTools run
  `location.href = "https://microsoft.com/devicelogin"`: on Microsoft's code-entry page a persistent warning names
  example.com. (2) In a new tab, type `microsoft.com/devicelogin` in the address bar: no warning. (3) On
  `https://learn.microsoft.com/` run the same `location.href` line in DevTools: no warning. (4) Repeat (1)
  with `https://www.google.com/device`: a warning on Google's code page. A failure gets a revert PR for `9641f9ef`.

- **AI-82 (#1224):** dummy credentials only, with the Gym served (`npm run gym:serve`). Open
  `http://localhost:5173/level11-credential-guard.html` (its form posts cross-site to 127.0.0.1). In DevTools
  change the password input to `type="text"` with `style="-webkit-text-security: disc"`, type a dummy value and
  submit: the credential prompt appears; Cancel. Reload, type into the real password field, then in DevTools set its
  `type` to `text` and submit: the prompt still appears. A cross-site search form on any site (for example a site
  search box that sets `autocomplete="new-password"`) shows no prompt. A failure gets a revert PR for `9d3e804e`.

- **AI-66 (#1183):** with the Gym served (`npm run gym:serve`): (1) open `gym/rw-fullscreen-locker.html`, press its
  button: fullscreen exits almost at once and the toast "Heedline closed a full-screen warning page..." appears;
  (2) on `gym/rw-fullscreen-benign.html` and a real fullscreen video (any video site, `f` key) or a slide deck in
  present mode, fullscreen stays. A failure gets a revert PR for the merge commit.

- **AI-59 (#1166):** a behaviour smoke check that ordinary copying still works. With the Gym served
  (`npm run gym:serve`): (1) on any page with a "Copy" button (a code block on a docs site), the button still
  copies and paste shows the expected text; (2) select text and press Ctrl+C: paste is unchanged; (3) open the
  Gym ClickFix page and click its fake verification: the ClickFix warning still appears. Same-realm bypass
  resistance (prototype calls, a deleted own property, cut, obfuscated commands) is covered by
  `tests/main-guard-clipboard-native.test.ts`, `tests/main-guard-execcommand.test.ts`,
  `tests/clickfix-detector.test.ts` and `tests/e2e/clipboard-native-contract.spec.ts`; natives taken from an
  uncovered about:blank frame remain open under #1134. A failure gets a revert PR for the merge commit.

- **AI-58 (#1165):** follow the [journal continuity checks](docs/vision-overhaul/PROTECTION_ACTIVITY.md#browser-proof-and-owner-check) in a disposable profile with fictional history. Check retained expansion, keyboard focus and reading position during arrivals; Show latest and explicit navigation; removal after replacement, eviction and clear; and the unchanged frozen export preview. Confirm screen-reader and physical-input behavior. The linked merge receipt identifies the exact merge commit. Automated evidence does not complete this check; a failed owner check gets a revert PR for that commit.

- **AI-57 (#1163):** follow [Protection Center activity](docs/vision-overhaul/PROTECTION_ACTIVITY.md#browser-proof-and-owner-check) in a disposable profile with fictional records. Review the four categories and separate corrections, keyboard drill-down, Today/history, narrow themes and reduced motion; use existing Options backup/import/clear only on that fictional history. Confirm screen-reader and physical-input behavior. Automated receipts do not complete this check. The PR's merge receipt records the exact merge commit; a failed owner check gets a revert PR for that commit.

- **AI-48 (#1100):** (1) a normal login on a real site still goes through after "Proceed once"; (2) on the
  fixture in `tests/e2e/credential-resubmit-retarget.spec.ts` (or any page whose submit handler swaps
  `formaction` to another site), the second prompt names the new host and Cancel sends nothing. Not part of
  this check: Firefox (#1101).
- **AI-50 (#1103):** with the popup blocker on, (1) a normal login still goes through after "Proceed once";
  (2) on the same fixture with a `_blank` retarget, any new tab receives no password and the original tab
  re-prompts for the new host.
- **AI-49 (#1098):** (1) an ordinary named popup trigger (visible text under 80 characters) opens its popup
  exactly as before; (2) a page whose popup anchor holds thousands of nodes neither stalls on click nor
  changes verdict for a short visible name.
- **AI-51 (#1104):** (1) a normal login still goes through as before; (2) on a local page with a password form
  and about 200,000 extra elements (`"<i>x</i>".repeat(200000)` appended to the body), submitting does not
  stall visibly before Heedline responds. The prompt's stylesheet lost only indentation in this PR; it should
  look unchanged.
- **AI-53 (#1077):** (1) on a normal site press **Trust** in the popup: status turns trusted, **Untrust**
  appears, Options > event log gains exactly one trust event; (2) press **Untrust**: status returns to
  observing, one untrust event; (3) optional: in the popup's DevTools run
  `chrome.storage.local.set = () => Promise.reject(new Error("x"))`, press **Trust**: the popup stays
  observing, the console shows "trust save failed", and no trust event is logged.
- **AI-54 (#1106):** (1) on a page whose script runs
  `document.open(); document.write('<form method=post action="https://other.example/x"><input type=password name=p value=x><button id=go>Go</button></form>'); document.close()`,
  clicking Go still shows the "Credential submit blocked" prompt and Cancel sends nothing to the other host;
  (2) a normal login still prompts (when risky) or goes through after "Proceed once". The local fixture is
  `tests/e2e/credential-document-open.spec.ts`. Not part of this check: a submit dispatched in the same task
  as `document.close()`, the MAIN-world and disabled js-behaviour listeners, Firefox.
- **AI-55 (#1017):** landed under the same retroactive rule (green CI, independent review, the unchanged 20,992-byte
  MAIN cap) by the estate-hub overnight session. In a child tab opened by a page: (1) with a same-origin opener, `window.opener.location.assign(url)`,
  `.replace(url)`, `.href = url` and `window.opener.location = url` navigate the opener with no TypeError; (2) with a
  cross-origin opener, `assign()` and reads still throw the native `SecurityError` and the opener is unchanged (as
  `tests/e2e/opener-location-native.spec.ts` expects), which is a pass, not a failure; (3) `window.opener = null` disowns it and a
  later assignment leaves it null. The local fixture is `tests/e2e/opener-location-native.spec.ts`. A failure gets a
  revert PR for `c47c5991`.
- **AI-56 (#1060):** landed under the same retroactive rule (green CI, independent review, MAIN budget 21 KB).
  A behaviour smoke check that ordinary forms still behave, not a hand-timed tamper test: the page-tamper
  resistance (a getter replaced between the document-start loader and the async MAIN import, or an own `call` set
  on the captured invoker) is covered by the vm-realm regressions in `tests/main-base-uri-loader-contract.test.ts`
  and `tests/form-target-self-exemption.test.ts`. In branded Chrome on the unpacked build of `a0035874`, with the
  Gym served (`npm run gym:serve`, port 5173): (1) run the acceptance procedure for the subframe self-target form,
  `NAVSENTINEL_BRANDED_CHROME=1 npm run test:acceptance -- tests/acceptance/fp-iframe-target-form.spec.ts` (fixture
  `tests/acceptance/fixtures/fp-iframe-target-form.html`): a background form post into the page's own named iframe is
  neither blocked nor announced, same-origin and cross-origin; (2) open `gym/base-uri-tamper.html`: the page's early
  baseURI tamper does not change the base the guard resolves against (the outcome the page itself describes). Describe any
  difference. A failure gets a revert PR for `a0035874`.
- **AI-52 (#1072):** a build-pipeline change only (CRXJS 2.7.1 to 3.0.0, with `chunkFileNames` keeping the
  `capture_isolated`, `main_guard` and `credential_guard` names), but the plugin regenerates the MAIN-world guard,
  the content-script loaders and the service-worker loader. On the unpacked build of `44d8875a`: (1)
  `chrome://extensions` shows no errors and the service worker starts; (2) on a real site a password-form submit
  still raises the credential prompt and "Proceed once" lets the login through; (3) a page that triggers a
  cross-site redirect or `window.open` still shows the navigation guard. Dev-server hot reload is not part of this
  check. A failure gets a revert PR for `44d8875a`.

### Branch-held Gate-3 items

**OPEN — credential named-property and UI-host recovery candidate**
(branch `fix/credential-named-property-and-host-reattach`).
This changes shipped credential interception and warning visibility; Gate-3 applies.
No human browser result is recorded. On the owner's loaded candidate build, use only
local fixture hosts and dummy credentials: submit a cross-site password POST whose form
contains `<input name="querySelectorAll">`; the prompt must appear and Cancel must send
zero POSTs. Remove a toast host, trigger another warning, and confirm it is visible.
Remove an open credential-modal host; the same pending decision must reappear and remain
usable. Automated Vitest/Playwright evidence does not complete this human check.

Each item below is defined **only** inside its own PR branch's `ACTION_ITEMS.md`
and the procedure named in its entry; `main` carries no procedure for them, so
this list is a pointer, not the gate. Read that procedure before acting and
verify the live PR head before building. Merged browser work is retained under
AI-47 below. Only Chris can complete these owner checks. This index update does
not resolve issue #639's owner decision about where future gate procedures should
live.

- **AI-31** — PR #572 (issue #566), branch `fix/issue566-modifier-authority`,
  exact head `e35a88e0a5ea24cf9c33d97b68ccfbeda57974bf`. Scope: trusted
  Ctrl/Cmd-click and middle-click keep modifier-click authority in the requested
  tab while synthetic reuse of the same events is refused. The PR is separately
  PARKED before this gate on failure record SP-F-013 (the ~1-in-50 rollback
  survivor); green CI is not containment evidence, so do not run the manual gate
  on the current head. Full procedure in that branch's
  `docs/agentic/GATE3_GUIDES.md`.
- **AI-48 to AI-56**: moved to [Retroactive Gate-3 checks](#retroactive-gate-3-checks-ai-48-onward) above by
  owner decision 2026-10-16, with AI-52 (#1072) added on 2026-10-24 after its Windows hold cleared. The AI-48 (#1100) and AI-50 (#1103)
  branch entries were retired here; build their merge commits, not the pre-merge code heads. An AI-49/51/53/54
  entry that a PR branch brings into this list on merge is superseded the same way: run the check on that PR's
  merge commit and record the result in the retroactive table.

### Integration closeout receipt

This row records integration state, not a human-test result:

| PR | Scope | Head at refresh | State | Merge SHA |
| --- | --- | --- | --- | --- |
| #658 | Conditional same-field Options writes | `0dc62f62e722de651169d3646669c0faf06fbd24` | MERGED; Human result waived with AI-47 (D-2026-09-27-S) | `8a9435349e0dcdbe834bfee2beeeccafd5b39ccf` |

### Merged browser work retained under AI-47

The following candidates are now on `main`; their owner checks were consolidated
in AI-47 and waived on agent evidence on 2026-09-27 (D-2026-09-27-S). A merge commit is an integration fact, not a human
Chrome result. Only Chris may perform and record observations; agents may only
preserve Chris's explicit observation.

| AI-47 row | Current scope and merge receipt | Exact local procedure | Human result |
| --- | --- | --- | --- |
| 1 | Toast controls #600 — `c8b1a70bef3c92600fdf7af3fb9fdc5e73b236f2` | [#600 owned-controls subprocedure](docs/agentic/GATE3_GUIDES.md#ai-47-former-ai-38-pr-600-current-main-toast-control-subprocedure) | WAIVED — agent evidence (D-2026-09-27-S) |
| 2 | Extension-origin Proceed #608 — `595903af89ff3bfb526e71de68f71f8c9459e6d1` | [#608 former-AI-39 procedure](docs/agentic/GATE3_GUIDES.md#active-guide-ai-39--issue-601-extension-origin-proceed-once) | WAIVED — agent evidence (D-2026-09-27-S) |
| 3 | Redirect freshness #609 — `e35f5430660767d4998c8f4d727b38444f3f9b14` | [#609 former-AI-40 procedure](docs/agentic/GATE3_GUIDES.md#ai-47-subprocedure-former-ai-40---609-stale-redirect-chain-boundary) | WAIVED — agent evidence (D-2026-09-27-S) |
| 4 | Child-frame navigation #636 — `d91d11f546a925cfc45f721856e1c8b0378ff23d`; form targets #649 — `c78ba99da5d3357833a5fcd3f4f09bdb255db7a6` | [#636 former-AI-41 procedure](docs/agentic/GATE3_GUIDES.md#retained-guide-ai-41---issue-593-child-frame-navigation-authority); [#649 former-AI-46 procedure](docs/agentic/AI-46-issue637-child-form-target.md) | WAIVED — agent evidence (D-2026-09-27-S) |
| 5 | Protection Center #640 — `a49cbc3e37f8ade547a97266588d894db1c3c33f`; evidence preview #641 — `7548954701f99377fed149c3be20135e39fe0b44` | [#640 acceptance procedure](docs/vision-overhaul/BROWSER_ACCEPTANCE.md); [#641 export procedure](docs/vision-overhaul/EXPORT_REVIEW.md#human-chrome-check--ai-45) | WAIVED — agent evidence (D-2026-09-27-S) |
| 6 | Settings #643 — `9524a8a7c38f972e66ef49b0f4cc991fb751e67f`; imported log limit #655 — `9b7ce93652b08c0e7f124f3ef132e46c6ab39909`; conditional writes #658 — `8a9435349e0dcdbe834bfee2beeeccafd5b39ccf` | [#643/#655/#658 current-main procedure](docs/agentic/GATE3_558_SETTINGS_AUTOSAVE.md) | WAIVED — agent evidence (D-2026-09-27-S) |
| 7 | Event association #644 — `7184e9d0a3bca699cae5e05426137258c836850e`; canonical IP sites #657 — `c760bb086023c4b83c8ef65693b5adf475414fda` | [#644/#657 association procedure](docs/agentic/ISSUE_585_GATE3.md) | WAIVED — agent evidence (D-2026-09-27-S) |
| 8 | Bridge queue pressure #599 — `d4b1acf5843605f519ffe1732050a2c1bb501ee1`; AI-37 policy accepted (D-2026-09-25-R) | [#599 current-main subprocedure](docs/agentic/GATE3_GUIDES.md#ai-47-row-8--599-current-main-clipboard-pressure) | WAIVED — agent evidence (D-2026-09-27-S) |

**WAIVED 2026-09-27: AI-47 — September browser-queue consolidated post-merge Chrome check.**
Chris waived the manual pass on the agent evidence of 2026-09-26
(D-2026-09-27-S). Record it as "manual gate waived on agent evidence", never
"Gate-3 passed". The procedure below is kept for reference and for any later
human pass.
On 2026-09-12 Chris explicitly directed the agent to merge the open PRs gated
behind human testing and retain the testing as one human TODO. The one-time
scope and exclusions are recorded in
[`D-2026-09-12-P`](docs/agentic/DECISIONS.md). This item is not evidence that
any branch-held Gate-3 passed. It applies only to named candidates that actually
merge after current-base conflict resolution, exact-head checks, review, and
stack ordering; record their merge commits here in the closeout sync. **This is
an index, not a shortened replacement procedure:** every step and evidence field
in each applicable current-`main` AI-47 subprocedure and branch-held exact guide
remains required. Record a sub-result for each former AI item before reporting
AI-47 as passed; one omitted sub-result keeps AI-47 open. (Superseded 2026-09-27:
AI-47 is waived, so this procedure is only for an optional later human pass.)
Every Human result in the table above started **OPEN — not run**. Only Chris may perform and record a
browser observation; a merge, CI run, or agent assertion must not change it.

Build the then-current `main`, record its 40-character SHA, and have Chris load
or reload that exact `extension/dist` in a fresh branded-Chrome profile. Confirm
the current page has capture and bridge markers `"1"` and the exact guard
revision printed by the build, then run this consolidated sequence:

1. **Owned controls ([#600 / former AI-38](docs/agentic/GATE3_GUIDES.md#ai-47-former-ai-38-pr-600-current-main-toast-control-subprocedure)):** complete the linked current-`main`
   subprocedure, including mouse and keyboard Dismiss and Undo, zero page-owned
   input reactions, and proof that a later hostile page layer cannot cover the
   extension host.
2. **Proceed authority ([#608 / former AI-39](docs/agentic/GATE3_GUIDES.md#active-guide-ai-39--issue-601-extension-origin-proceed-once)):** complete the exact AI-39 guide.
   Page-injected UI remains warn/dismiss only, except the same-tab rollback
   notice's trusted-input Proceed (row 4; owner ruling 2026-09-25, #872,
   D-2026-09-25-Q); Proceed once lives in the
   extension popup, shows only the bounded origin/countdown presentation, opens
   exactly once with a null opener, and remains fail-closed after replay,
   expiry, navigation, or use from another tab. Confirm path/query/fragment data
   is absent from `chrome.storage.session`, popup DOM, and relevant consoles.
3. **History and redirect freshness (#609 / former AI-40):** complete the
   [exact former AI-40 guide retained as this AI-47 subprocedure](docs/agentic/GATE3_GUIDES.md#ai-47-subprocedure-former-ai-40---609-stale-redirect-chain-boundary). A real
   Back/Forward Cache restore inherits no stale redirect-chain factors, and the
   same factors expire without a navigation. A reload is not an equivalent
   check.
4. **Child-frame authority ([#636 / former AI-41](docs/agentic/GATE3_GUIDES.md#retained-guide-ai-41---issue-593-child-frame-navigation-authority) and [#649 / former AI-46](docs/agentic/AI-46-issue637-child-form-target.md)):** complete both exact
   guides. The transparent child-frame navigation case is contained with its
   deliberate Proceed path intact; the normal declared-form and Back paths stay
   compatible; changed, replayed, or unrelated form targets remain denied.
5. **Protection Center and export ([#640 / former AI-42](docs/vision-overhaul/BROWSER_ACCEPTANCE.md) and [#641 / former AI-45](docs/vision-overhaul/EXPORT_REVIEW.md#human-chrome-check--ai-45)):** complete both
   exact guides, including popup/Options entry points, themes, category states,
   keyboard operation, cancel paths, preview/download byte parity, minimized
   export privacy, and the absence of page-injected Allow/Proceed controls
   other than the same-tab rollback notice's trusted-input Proceed (#872).
6. **Settings concurrency ([#643/#655/#658 / former AI-43](docs/agentic/GATE3_558_SETTINGS_AUTOSAVE.md)):** complete the exact
   guide for merged #643/#655/#658. Default autosave, explicit conflicts, and
   imported integer log limit `55` must match the guide. #658's same-field
   collision, disjoint-window merge, and preservation of the losing draft remain
   **OPEN — not run** for Chris to observe on the selected current-`main` build.
7. **Event association ([#644/#657 / former AI-44](docs/agentic/ISSUE_585_GATE3.md)):** complete the exact guide and the child-PR addition. Imported event `pageSite` validation,
   full-URL sanitization, legacy popup fallback, and canonical IP-site
   association remain correct without leaking an event to an unrelated
   top-level page.
8. **Bridge queue pressure ([#599 / former AI-37](docs/agentic/GATE3_GUIDES.md#ai-47-row-8--599-current-main-clipboard-pressure)):** complete the current-`main` subprocedure, which #947 replaced on 2026-09-27 with the `clickfix-06` pressure page. The page needs Clipboard set to Allow for `localhost:5173`. The benign copy page must remain usable without a warning. A benign clipboard flood in NavSentinel's pre-handshake window must stay silent. The attack arm's command-like write must still raise the fake-verification warning, and neither arm may add a `bridge_buffer_overflow` row. Record both self-check lines, the event-log outcome and console observations. The queue policy was accepted; AI-47 was waived on agent evidence on 2026-09-27 (D-2026-09-27-S), so this procedure is for an optional later human pass.

Inspect page, popup, Options, Protection Center, and service-worker consoles for
new errors during the relevant steps. Only after Chris has explicitly recorded
every applicable row may Chris report `AI-47 done; consolidated Gate-3 passed on
main at <40-character SHA>; Chrome <version>`. Before the 2026-09-27 waiver, #658 kept row 6 and
AI-47 open until Chris recorded its observation. On a mismatch, Chris records
`AI-47 failed on main at <SHA>: <numbered step and observed result>`. A failure
reopens the smallest affected issue/PR slice; it does not invalidate unrelated
checks. The general guided cursor is AI-19 (D-2026-09-27-S).

**Agent pre-check, 2026-09-24 (automated evidence only; every Human result above
stays OPEN — not run):** each AI-47 row and AI-24/30/33/35/36 now has an
acceptance spec that ran in branded Chrome 153 on main `da3db0b6`; see
[`docs/testing/BRANDED_CHROME_VALIDATION_2026-09-24.md`](docs/testing/BRANDED_CHROME_VALIDATION_2026-09-24.md).
All written trusted-input steps passed except row 5's "readable reasons" step,
which fails as written (#867). The added adversarial arms for rows 1 and 4 fail:
a page script can press NavSentinel's own controls (#783/#826; fix candidates
#784/#827 were verified to close it). Consider landing those fixes before the
owner pass. Rows 2 and 5 forbade page-injected Proceed controls while row 4
requires the same-tab rollback notice's Proceed. **Resolved 2026-09-25 by Chris
(#872, D-2026-09-25-Q):** row 4 holds, and rows 2 and 5 now exempt that notice.

**Release-build scope, 2026-09-25 (D-2026-09-25-Q):** Chris chose to run AI-47
once, on the v0.5.0 release build, instead of per PR. The PRs merged under that
decision are listed in the `[0.5.0]` section of `CHANGELOG.md`; run the pass
only on the tagged `v0.5.0` build (the release zip, or a build of tag
`v0.5.0`), whose changelog section is the authoritative scope. The
pass also covers the everyday flows this release targets: cross-site links whose
text sits in a span or icon (DuckDuckGo results, GitHub tabs, YouTube "Watch
on YouTube"), script-submitted sign-in forms (Stack Overflow "Log in with
Google"), forms posted into a page's own iframe, and the credential prompt's
buttons, Escape and backdrop with mouse and keyboard. v0.5.0 still blocks the
script-submitted and own-iframe form posts (#864, #865; the proposed #895 fix
is not in this release), so for those two flows the pass confirms the
documented limit rather than a fix. Every Human result stays
**OPEN — not run** until Chris records it.

**Agent pass on the v0.5.0 release build, 2026-09-26 (automated evidence only;
every Human result above stays OPEN — not run):** Chris asked the agent to run as
much of AI-47 as it could. On tag `v0.5.0` (`15a81274`, byte-identical to the
published zip) in Chrome 153.0.8010.53 with realistic settings, all eight rows
passed their acceptance specs. Row 8 now has its own spec,
`ai47-8-clipboard-pressure`. Row 8's original procedure could not detect a #599
regression because the benign prewrite alone warned (#947); the redesigned
`clickfix-06` procedure's acceptance spec fails on a build with #599 removed and passes on
the real one. The #599 oracle is the
NS-ADV-SELF-005 e2e test, which passes. The everyday-flow specs passed except the two known
limits #864 and #865. #864 is fixed on `main` after v0.5.0 by #895, whose
wave passed `fp-form-submit-patterns`; #865 remains open. The live-web lane found one new false
positive: the real YouTube embed's "Watch on YouTube" link still prompts (#943).
Details, and the parts automation cannot cover, are in
[`docs/testing/AI47_V050_AGENT_PASS_2026-09-26.md`](docs/testing/AI47_V050_AGENT_PASS_2026-09-26.md).
On 2026-09-27 Chris waived the manual pass on this evidence (D-2026-09-27-S).

**OPEN: AI-36 — #558 popup/Options patch-save synchronization post-merge
Gate-3.** This is no longer a pre-merge gate. PR #589 merged on 2026-08-27 (head
`ee75bf408e04f528b0ee08006471f318fba3ef96`, merge commit
`003905094982b9a772cc5f06fe504d372c99dd6b`) and **no waiver record for that merge
was found** in `docs/agentic/DECISIONS.md`, `HANDOFF.md`, this file, or
`docs/Project_Roadmap.md`; no waiver or owner decision is claimed. Run the active
manual Chrome guide in [`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md)
against current `main`. Build that exact head, then load that build in a fresh
Chrome profile. Keep one valid Options field dirty, change both protection modes in the
popup, and confirm the clean Options controls update live without discarding the
dirty field. Save from Options and confirm the popup changes survive. Inspect
Options, popup, and service-worker consoles. This gate covers the bounded
patch-save/live-sync slice, not #558's remaining auto-save preference, dirty-state
warning, or same-field conflict UX. Only Chris can complete this human Gate-3.
The AI-36 guide carries a matching post-merge banner. Reply `AI-36 done; Gate-3
passed on main at <40-character SHA>; Chrome <version>` or `AI-36 failed on main
at <SHA>: <step and observed>`.
The general guided resolution cursor is AI-19; AI-36 is an additional
branch-specific gate.

**OPEN: AI-35 — #539 cross-host child-event attribution post-merge Gate-3.**
This is no longer a pre-merge gate. PR #586 merged on 2026-08-27 (head
`96be8e09cfe51168e4231625154ed366a408940b`, merge commit
`b68f403a7f14379305cf1376f3ee4f188ef31493`) and **no waiver record for that merge
was found** in `docs/agentic/DECISIONS.md`, `HANDOFF.md`, this file, or
`docs/Project_Roadmap.md`; no waiver or owner decision is claimed. Run the active
manual Chrome guide in [`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md)
against current `main`. Build that exact head, load that build in a fresh Chrome
profile, and confirm a cross-host child-frame event keeps its emitting `site`
while the popup associates it with the top-level page; also confirm an unrelated
top-level page does not inherit the event. Inspect page, popup, and service-worker
consoles. Only Chris can complete this human Gate-3. The AI-35 guide carries a
matching post-merge banner. Reply `AI-35 done; Gate-3 passed on main at
<40-character SHA>; Chrome <version>` or `AI-35 failed on main at <SHA>: <step
and observed>`. The general guided
resolution cursor is AI-19; AI-35 is an additional branch-specific gate.

**OPEN: AI-33 — Issue #530 popup trust-pill contrast post-merge Gate-3.** This
is no longer a pre-merge gate. PR #582 merged on 2026-08-27 (head
`02b8e5c4504ff5127a9b6c4af7cf8cc30fd07da2`, merge commit
`d1895b51763a6c6b7b5280f0ea80664d2f0c796d`) and **no waiver record for that merge
was found** in `docs/agentic/DECISIONS.md`, `HANDOFF.md`, this file, or
`docs/Project_Roadmap.md`; no waiver or owner decision is claimed. Build the
current `main` head and follow the active AI-33 procedure in
[`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md). Verify the
observing and trusted labels remain readable, visibly distinct from signal
chips, unclipped, keyboard-operable, and free of new popup-console errors. Only
Chris can record this complete. Reply `AI-33 done; Gate-3 passed on main at
<40-character SHA>; Chrome <version>` or `AI-33 failed on main at <SHA>:
<step and observed>`. This PR-specific gate does not move the general guided-
resolution cursor from AI-19.

**OPEN: AI-30 - #567 Back/Forward history-integrity post-merge Gate-3.** This is
no longer a pre-merge gate. PR #570 merged on 2026-08-27 (head
`20fad0ac9d19bcbe3a1ca6b2d43ab14c7438ce53`, merge commit
`ff063a677b6c633c1eca4955dbfe9b277e529f3a`) and **no waiver record for that merge
was found** in `docs/agentic/DECISIONS.md`, `HANDOFF.md`, this file, or
`docs/Project_Roadmap.md`; no waiver or owner decision is claimed. Build the
current `main` head and follow the active AI-30 procedure in
[`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md). Verify that a
cross-site local P -> A -> B history remains intact after ordinary navigation
allowances expire: Back stays on A, Forward returns to B, and two Back actions
reach A then P without a NavSentinel rollback, skipped entry, or unexpected
prompt. Also confirm the existing delayed page-initiated redirect still rolls
back. Only Chris can record this complete. Reply `AI-30 done; Gate-3 passed on
main at <40-character SHA>; Chrome <version>` or `AI-30 failed on main at
<SHA>: <step and observed>`. This PR-specific gate does not move the general
guided-resolution cursor from AI-19.

**OPEN: AI-19 — Clear or replace the working product name before CWS submission.**
TruNav publicly uses the exact name `NavSentinel` for a coming-soon GNSS
anti-spoofing receiver. This is a risk flag, not legal advice. Choose either
`AI-19 rename; generate shortlist` or `AI-19 keep; begin formal clearance`.
For either route, record the intended territories and goods/services, search
relevant trademark/product/store/domain/handle sources, retain dated results, and
obtain professional advice before a commercial or public launch. A rename must
coordinate product, store, asset, and repository names. Reply `AI-19 done:
<decision>` when complete. **2026-09-25:** Chris chose to decide later; the
GitHub pre-release keeps the working name, and AI-19 still gates the store
submission. **2026-09-27 (D-2026-09-27-S, D-2026-09-27-T):** Chris chose the rename route
and then the name **Heedline**. The screen is in
[`docs/agentic/NAMING_SCREEN_2026-09-27.md`](docs/agentic/NAMING_SCREEN_2026-09-27.md).
User-facing surfaces are renamed; internal identifiers keep the former name.
Still open before the store submission: a formal trademark search (US and EU,
classes 9/42), professional advice, the repository name, and the store
listing and handles.

**OPEN: AI-24 — Optional post-merge real-Chrome confirmation.** Build current
`main`, load `extension/dist` unpacked in a fresh temporary Chrome profile, and
check the merged #356/#464/#466 result: delayed redirect rollback and toast,
programmatic-submit block then exactly one allow-once action, Level-5 popunder
block, OAuth popup by physical click/Tab+Enter/submit input (exactly one popup and
no prompt), plus MV3 service-worker registration in `chrome://extensions`. Record
Chrome version and any unexpected result with `AI-24 done` or `AI-24 failed:
<step and observed>`. Only Chris can record this complete. This is not a release blocker. See
[`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md) and the archive for
historical procedure provenance.

**BLOCKED: AI-15 — Headed release session.** Do not revive the withdrawn
one-sitting guide. It becomes actionable only after an agent supplies a current
preflight that resolves or deliberately defers RI-01, stale #273/AI-8, visual-sim
and fake DNR, RI-06 minimization/reset, RI-07 beta-off behavior, #175/#186 bridge
integrity, #455 consent, and a current headed checklist. Start with
`docs/Product_Strategy.md`.

**BLOCKED: AI-8 — Neutral-chip Gate-3 after closed PR #273.** Do not use the
stale branch guide. An agent must recreate or defer the change from current `main`,
resolve its preserved review findings, prove focused checks and hosted CI, then
provide a new visual-check guide.

**RESOLVED 2026-09-25: AI-23 — Worktree and branch housekeeping.** Chris
approved both named retirements (D-2026-09-25-R). A fresh inventory showed:

- the `nav-floor-sync` worktree clean, with only an ignored `__pycache__/`;
- `chore/deny-floor-v1.6.3` equal to `origin` at `f438b530`;
- `fix/cooldown-map-cap` holding one local-only commit, `d682f144`.

`d682f144` was pushed to `origin/archive/fix-cooldown-map-cap-308` first. Then
both were removed with a plain `git worktree remove` and `git branch -d`. The
RI-01 and issue-496 worktrees and the local-only
`fix/user-activation-neutral-chip` branch are kept. Any future removal still
needs named approval.

### Owner acknowledgement list (non-blocking)

Chris asked for decisions made on his behalf that need a look but no action to
be listed in one place. Nothing here blocks v0.5.0. Reply `ack` with the row
numbers (for example `ack 1-6`), or name a row to reopen it. Chris acknowledged rows 1–9 on 2026-09-26
(`ack 1-9`).

| # | What was decided or done | Where | Ack |
| --- | --- | --- | --- |
| 1 | The total-dist size budget rose from 500 KB to 540 KB, and the popup script budget from 10.5 KB to 11.5 KB. Budgets for scripts injected into pages are unchanged. | #876, #885 | ack 2026-09-26 |
| 2 | Codex findings declined with a reason on the thread: #788 (a huge `<base href>` only slows the attacker's own page), #789 (the page author controls its own metas), #827 (redressing a trusted click is the known #601 residue), #814/#823 (process note covered by D-2026-09-25-Q). | PR threads | ack 2026-09-26 |
| 3 | PRs closed without merging. Superseded: #772 by #757, #767 by #761, #779 by #823. Not needed: #847/#848 (the listeners were already registered once), #815/#816 (`tabs.sendMessage` cannot come from another extension). | PR threads | ack 2026-09-26 |
| 4 | Parked, not in v0.5.0: #572 (SP-F-013), #842/#858 (open Codex findings), #791/#819/#860 (JavaScript-behaviour instrumentation is compiled out), #755 (overlaps #768), #698/#707/#709 (need a rebase and size work). | PR comments | ack 2026-09-26 |
| 5 | #882 (#863) deliberately leaves two false-positive shapes: a see-through state layer inside a link that paints nothing at the click point is still held, and an unnamed overlay link still scores as before. GitHub's pushState bursts still raise `pushstate_abuse`, but stay under the block threshold. | #882 | ack 2026-09-26 |
| 6 | Follow-up issues filed during the release push rather than fixed in it: #877 (MAIN-world clock capture), #884 (popup readiness marker), #886 (#882's own-paint check), #887 (RW-01 onboarding-tab race), #890 (an approved blocked form submit re-reads a live, swappable action), #891 (lower-severity bug-hunt findings). | Issues | ack 2026-09-26 |
| 7 | A cross-vendor Muse bug hunt ran on the release candidate. Its fixable findings shipped (#889, #892, and the PRIVACY.md wording). It rated the known bridge-handshake weakness (#186) CRITICAL: a page that races the MAIN-world bridge handshake can switch the in-page guard off for itself. The service-worker rollback and the isolated-world detectors still run. The fix needs design, so v0.5.0 ships with #186 disclosed as open. | #186 | ack 2026-09-26 |
| 8 | The automated branded-Chrome and acceptance runs are evidence, not your Gate-3 result: every AI-47 row stays **OPEN — not run** until you record it. | AI-47 | ack 2026-09-26 |
| 9 | v0.5.0 was tagged with the acceptance lane red on exactly two false-positive tests, `fp-form-submit-patterns` and `fp-iframe-target-form`. They reproduce the open #864/#865 limits that the release notes disclose, and main's scheduled branded run shows the same two. Twelve of the fourteen steps of the final local verification at `cc904a91` passed. The other red step, the default E2E lane, had two first-attempt timing failures under machine load, RW-03 and the #593 `top-assign-100` rollback arm. Both passed on retry and in 14 isolated reruns with retries off; the observation is recorded on #593. | #864, #865, #593 | ack 2026-09-26 |

**BLOCKED: AI-14 — OAuth tradeoff measurement after closed PR #399.** Keep #223
blocked until #417 supplies valid methodology and a current slice provides focused
checks, hosted CI, and a reproducible headed measurement plan. The owner waived
this hold for #531 only; that did not establish a real-Chrome, `measure:fp`, or
headed-measurement result and does not waive future methodology.

## Completed and superseded log

- AI-23 — resolved 2026-09-25: Chris approved retiring `nav-floor-sync` /
  `chore/deny-floor-v1.6.3` and `fix/cooldown-map-cap`. Both commits are
  preserved on `origin` (D-2026-09-25-R).
- AI-37 (policy half) — resolved 2026-09-25: Chris accepted #599's
  unverified-window clipboard coalescing. Its Chrome check joined AI-47, which was
  waived on agent evidence on 2026-09-27 (D-2026-09-27-S).
- AI-29 - resolved 2026-08-28: Chris accepted PR #557's exact `ee804fa` overlay
  behavior and authorized merge; the PR merged as
  `d132eace0d2b7e905d5d6eb5ad4c831236f925b2`, closing #555, #559, and #568. #560
  retains the accepted regular redirect-card Dismiss/Allow-once regression.
- AI-28 — resolved 2026-08-10: #535 records the behavioural-data reset boundary;
  it clears event log, prompt outcomes, adaptive scores, and domain profiles while
  preserving settings, allowlist, and trusted domains.
- AI-27 — resolved 2026-08-10: the eleven-PR browser queue merged under an
  explicit waiver; AI-24 remains the optional real-Chrome confirmation.
- AI-26 — no distinct register entry was ever created; its #514 Gate-3 residue is
  represented by AI-27/AI-24.
- AI-25 — done 2026-08-01: #509 interaction-only Gate-3 completed in Chrome.
- AI-22 and AI-21 — resolved 2026-07-25 under manual-gate waivers; their merged
  checks are consolidated into optional AI-24.
- AI-20 — done 2026-08-01: original Defender fixture remains quarantined; the
  runtime-equivalent replacement is scan-clean.
- AI-18 — resolved/superseded 2026-07-31: #499 removed the project-hook trust
  surface; no re-trust action remains.
- AI-17 — accepted 2026-08-01: Chris accepts `main` without branch protection.
- AI-16 — ratified 2026-08-01: July standing product/process decisions recorded.
- AI-13 — resolved 2026-07-25 under a manual-gate waiver; AI-24 owns optional
  merged-result confirmation.
- AI-12 — done 2026-06-23: top-site FP relief merged after manual confirmation.
- AI-11 — done 2026-06-23: toast count-pill merged.
- AI-10 — done 2026-06-23: SPA-breakage fix merged after manual Chrome check.
- AI-9 — decided 2026-08-01: interaction-only is the release-eligible default;
  research-reputation remains unpacked-only and non-release.
- AI-6, AI-5, AI-4, AI-3, AI-2, and AI-1 — resolved or superseded in June 2026;
  see the dated archive for decisions, waivers, and historical procedures.

## Provenance

This file deliberately retains one current snapshot, the open/blocked queue, and
one-line outcomes. Historical snapshots, resolved-item detail, original guides,
exact-head records, and superseded procedures are preserved in the dated archive;
they are not current operator guidance. `docs/agentic/ORCHESTRATOR.md` is also a
retired historical cycle ledger, not a living orchestrator.
