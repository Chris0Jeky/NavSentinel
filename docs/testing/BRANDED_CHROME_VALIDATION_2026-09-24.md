# Branded-Chrome validation — 2026-09-24

**Scope:** everything merged after the last owner manual Chrome pass. That pass was AI-29, PR #557 "hide initial risky overlays", merged 2026-08-28. The window runs up to main `da3db0b6`, about 90 PRs.

**Classification:** automated agent evidence from real Google Chrome. **None of this is an owner Gate-3 result.** AI-30, AI-33, AI-35, AI-36 and every AI-47 row stay **OPEN — not run** in `ACTION_ITEMS.md` until Chris records his own observation. The receipts are meant to make that pass fast, and they show where it will stumble. Only AI-47 row 5 fails a written step. Rows 1 and 4 fail only the adversarial arms added here.

## How it was tested

| Lane | What it adds | Entry point |
| --- | --- | --- |
| Branded engine | Existing E2E lanes on the installed branded Chrome. The unpacked build is loaded through the DevTools `Extensions.loadUnpacked` command, because branded Chrome ignores `--load-extension` since 137. | `npm run test:e2e:branded` |
| Realistic switches | Removes Playwright's realism-distorting defaults: `--disable-back-forward-cache`, `--disable-popup-blocking`, background throttling, `--no-sandbox` and more. Every hosted E2E run carries those defaults. | `NAVSENTINEL_REALISTIC_CHROME=1` |
| Acceptance procedures | One spec per owner guide step: fresh profile, the **real toolbar popup** driven over DevTools with trusted input, and a receipt per procedure (head, product tree, dist hash, Chrome build, readiness markers, step outcomes, console from every surface, screenshots, storage). | `npm run test:acceptance` (receipts in `artifacts/acceptance/<run>/`) |
| Restarts | MV3 worker termination (new realm proven) and a full browser relaunch on the same profile. | `AcceptanceSession.stopServiceWorker()` / `restartBrowser()` |
| Live web | Opt-in sampling of user-requested flows on real sites, recording every intervention. | `NAVSENTINEL_LIVE=1 npm run test:acceptance -- live-web` |
| Baseline attribution | Runs any procedure against an older build to date a defect. | `EXTENSION_PATH=<dist> NAVSENTINEL_EXPECTED_GUARD=<rev>` |

**Harness adaptations, all in `tests/branded/branded-chrome-preload.cjs`:**
- **Chrome 153 popups:** Playwright 1.57 targets Chromium 143, and on Chrome 153 it reports a popup's initial empty document as loaded. The shim waits for the popup's real first navigation. Measured: the same effect occurs without the extension.
- **Back/forward-cache restores:** a restored page fires no `load`/`DOMContentLoaded`. Realistic mode resolves `goBack`/`goForward`/`waitForURL` on commit plus a settled document.

## Results by merged capability

"Pass" means every encoded guide step passed in branded Chrome 153.0.8010.53 in realistic mode, unless noted.

| Owner item | Capability (PRs) | Result |
| --- | --- | --- |
| AI-30 | Back/Forward history integrity (#570) | Pass: real back/forward-cache restores; delayed redirect still rolls back |
| AI-33 | Trust-pill contrast (#582) | Pass: contrast measured from pixels, 9.13:1 / 8.1:1; keyboard Trust/Untrust |
| AI-35 | Cross-host child-event attribution (#586) | Pass: `site`/`pageSite` minimized; no leakage to an unrelated tab |
| AI-36 | Popup/Options patch-save sync (#589) | Pass: with Auto-save off, as the guide predates it |
| AI-47.1 | Owned toast controls (#600) | Trusted input: pass. **Page-script activation: fail** (#783/#826; fixes #784/#827 verified) |
| AI-47.2 | Extension-origin Proceed once (#608) | Pass, including replay, expiry, cross-tab and post-navigation consume attempts, and no destination marker in session storage |
| AI-47.3 | Stale redirect-chain boundary (#609) | Pass: "BFCache restored: yes" on Back and Forward; 16 s expiry |
| AI-47.4 | Child-frame authority (#636, #649) | Trusted flows: pass. **Page-script rollback Proceed: fail** (#783/#826) |
| AI-47.5 | Protection Center and export (#640, #641) | Themes, keyboard, preview/download byte parity, privacy scan: pass. **Readable reasons: fail** (#867). The rollback toast's page-injected Proceed conflicts with the row's wording (#872) |
| AI-47.6 | Autosave, conflicts, log limit (#643, #655, #658) | Pass, including the two-window same-field collision |
| AI-47.7 | Event association (#644, #657) | Pass, including canonical IPv4/IPv6 |
| AI-24 | Merged #356/#464/#466 | Pass: rollback + Proceed, programmatic submit, popunder, OAuth popup by click / Tab+Enter / input |
| AI-29 regression | Overlay cleanup (#557) | Pass: trap hidden before interaction, Undo, hostile persistence, benign controls. Red-team evasions noted in #868 |
| — | Storage hardening wave (#793–#862) | Protection survives hostile state, a worker restart and a browser relaunch. **Mode validation defect** (#866) |

**Existing suites:**

| Suite | Result |
| --- | --- |
| Full E2E, branded Chrome 153, default switches | Full run without the popup shim: 160 pass, 9 fail, 2 skipped. All 9 were the Chrome 153 popup-URL harness gap (same with no extension loaded) and pass on rerun with the shim. |
| Full E2E, realistic mode | 168 pass, 1 test race (fixed here), 2 skipped; see "Final runs" |
| Rollback lane (not in CI) | 4/4, default and realistic |
| Unit suite, Windows | 3,547 pass / 1 skipped with lockfile dependencies. This checkout's `node_modules` holds stale `happy-dom` 20.9.0 against 20.14.5 locked, which caused 2 local failures; `npm ci` fixes it. |
| Typecheck, lint | Pass |

## Defects found

| Sev. | Issue | Summary | Since |
| --- | --- | --- | --- |
| CRITICAL / HIGH | #783, #826 (fixes #784, #827) | A page script can activate NavSentinel's own controls. After one lured click, it can make the credential modal submit the password cross-site, persist trust, persist an allowlist entry, or complete a rolled-back navigation. | ≤ 08-28 (#600 narrowed it) |
| HIGH (quietness) | #863 | A click on a link's own child (span/icon/h3) adds +35 "intent mismatch". It blocks DuckDuckGo result titles, GitHub tabs after the first SPA navigation, YouTube "Watch on YouTube", and any span-wrapped cross-site link. | ≤ 08-28 (Jan 2026 rule) |
| HIGH (quietness) | #864 | Same-task script form submits after a trusted action are blocked: Stack Overflow "Log in with Google", validation libraries, auto-submit pickers. | ≤ 08-28 |
| MEDIUM | #865 | A form posted into the page's own named iframe is blocked with a notice. Seen live on Reddit. | ≤ 08-28 |
| MEDIUM | #866 | An imported invalid mode renders as Off while protection is actually still on (Smart); a non-string mode crashes the popup and Options. | — |
| MEDIUM | #867 | The Protection Center shows no readable reasons for real events, which fails AI-47 row 5 as written. | since #640 |
| MEDIUM | #868 | Overlay cleanup can be exhausted (200 traps, 83 left visible) or evaded by per-frame rebuild, with no visible warning. | — |
| LOW | #869 | Duplicate rollback Dismiss, uncapped legacy journal rows, junk imported trusted domains. | ≤ 08-28 |

None of the eight defects above is a regression from the September waves; each was reproduced on the 08-28 baseline or has existed longer. What changed is coverage: fixtures only used bare-text links, synchronous-after-click submits and top-level targets, and CI never ran branded Chrome, the back/forward cache or real sites.

## Final runs (current head of this branch, product source = main `da3db0b6`)

Branded Chrome 153.0.8010.53, fresh profiles, one worker, no other Chrome lane running.

**Full E2E, realistic mode (`CI=1`, retries on):** 168 passed, 1 failed, 2 skipped.
- The failure was `clickfix-01`, on both the first try and the retry. Each time, the ClickFix toast appeared, but a single event-log read taken straight after it was empty.
- The toast renders synchronously, while the content script hands the event write to the service worker.
- Isolated reruns (20 repeats, no retries): the entry had already landed at the first read in 19 of 20; in the other it arrived 109 ms later. No entry was lost.
- This was a race in the test, fixed on this branch by polling like the neighbouring mutation tests. The ClickFix group now passes 4/4 in realistic mode.
- One similar single read remains in the inert-overlay cases of the same spec. It has not failed and was left alone.

**Acceptance lane:** 16 passed, 9 failed, 1 skipped (live web is opt-in). Every failure is an intended reproduction of a filed issue. None is a new regression.

| Spec | Failing steps | Issue |
| --- | --- | --- |
| AI-47.1 adversarial | Page-dispatched Dismiss, Undo, Always allow, Allow once | #783, #826 |
| AI-47.4a | The page can script-click the rollback Proceed | #783, #826 |
| AI-47.5 | 5a: no readable reasons for a real stored event | #867 |
| AI-47.5 | setup-c2: the same-tab rollback toast carries a page-injected **Proceed** | #872 (conflict in the guide text, below) |
| fp-form-submit-patterns | 6 of 9 script-submit patterns blocked | #864 |
| fp-iframe-target-form | Same-origin and cross-site posts into a named iframe | #865 |
| fp-link-child | Span and icon children, same tab and `_blank` | #863 |
| fp-state-layer | Top frame and cross-site embed (YouTube pattern) | #863 |
| redteam-1 | Synthetic Proceed once, Trust, and a toast action | #783, #826 |
| robustness-corrupt-state | Invalid modes shown as Off or crashing the popup; uncaught exceptions; legacy 200 KB row not re-capped | #866, #869 |

**Guide conflict (#872).** The AI-47 rows in `ACTION_ITEMS.md` disagree.
- Rows 2 and 5 require page-injected UI to have no Allow/Proceed.
- Row 4 requires the same-tab rollback notice to keep its page-injected Proceed.
- The exact #640 guide requires neither.
- An owner following the rows literally will fail one or the other. Chris needs to choose which rule the wording should follow.

## Not verified

- Anything at `chrome://extensions` or in Chris's own profile; hardware mouse input (DevTools input is trusted and grants user activation, but it is not an OS event).
- Human judgements: readability, wording, and visual polish beyond measured contrast and clipping.
- Live-site results are samples at one time and location (Netherlands egress). No live malicious sites were visited; every attack ran against loopback fixtures.
- `measure:fp` over the Tranco list was not run. Its methodology is still unvalidated (AI-14, #417).

## Rerun

```bash
npm run build
npm run test:e2e:branded
NAVSENTINEL_REALISTIC_CHROME=1 npm run test:e2e:branded
npm run test:acceptance
NAVSENTINEL_LIVE=1 npm run test:acceptance -- live-web
```
