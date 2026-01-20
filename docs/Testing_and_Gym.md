# Testing and Gym

## Gym purpose
The Gym is a deterministic set of local HTML pages that simulate common malicious and legitimate patterns. It provides a stable target for manual testing and automated E2E tests.

## What NavSentinel currently enforces
- `_blank` links: blocked (toast prompt) unless user shows explicit intent (Ctrl/Cmd+click, middle click) or the destination is allowlisted.
- `window.open`: blocked (toast prompt) unless the click was explicitly "new tab intent" (Ctrl/Cmd/middle) or the destination is allowlisted.
- Same-tab redirects (`location.assign/replace`) + form submits: allowed only shortly after an allowed click; delayed redirects auto-roll back then offer a proceed prompt; delayed submits prompt.
Note:
- CDS < 40 does not automatically allow new-tab navigations. New-tab gating is separate from CDS and is stricter by design.

Modes:
- `Off`: should not block (use this to sanity-check the Gym without NavSentinel).
- `Smart`: allows clean `_blank` links (named, visible, low CDS) and prompts on suspicious ones.
- `Strict`: blocks `_blank` links unless explicit new-tab intent or allowlisted.
  - Deceptive click block threshold is lower (CDS >= 50 in Strict, CDS >= 70 in Smart).
- `DNR backstop` (Options): optional hard blocklist using MV3 DNR rules. If enabled, matching destinations are blocked without a prompt.

Prompt vs block:
- Prompt = a toast with `Allow once` / `Always allow` (used for navigations).
- Block = toast with only `Dismiss` (used for deceptive clicks with no safe replay).
- Rollback prompt = a toast with `Proceed` / `Dismiss` shown after an auto-rollback from a client-side redirect.

## What "block" means in the Gym
- For `_blank` links: NavSentinel calls `preventDefault()` and shows an in-page prompt (toast) with `Allow once` / `Always allow`.
- For `window.open`, `location.assign/replace`, and `form.submit/requestSubmit`: NavSentinel patches these in the page's main world and blocks the call, then shows a prompt. Clicking `Allow once` replays the exact blocked action.

## Quick demo
1. Run the Gym server: `cd gym` then `python -m http.server 5173`.
2. Open `http://localhost:5173/index.html` and choose a level.
3. Load the unpacked extension and enable the debug overlay in Options.
4. Click the page elements and watch CDS, reasons, and decisions live.

## Options page (Chrome)
If the Options link is missing in `chrome://extensions`, open it directly:
1. Go to `chrome://extensions` and copy the extension ID.
2. Open `chrome-extension://<ID>/src/options/options.html`.
3. Use the Allowlist section to remove hosts or clear all entries.

## Gym levels and expected outcomes (manual)
- Level 1 (invisible overlay anchor): click `Play`. Expected (Smart/Strict): prompt "Blocked new tab" for `example.com`.
- Level 2 (overlay follows mouse): move your mouse onto `Real Button` (so the invisible trap is positioned over it), then click. Expected (Smart/Strict): prompt "Blocked new tab" for `example.org`.
- Level 3 (instant injection on pointerdown): click `Click me` normally. Expected (Smart/Strict): blocked deceptive click (high CDS) and no navigation.
- Level 4 (visual mimicry): click `Download`. Expected (Smart/Strict): prompt or block (depending on CDS); no surprise tab.
- Level 5 (any click triggers `window.open`): click inside the box. Expected (Smart/Strict): prompt "Blocked popup" for `example.com/?ad=1`.
- Level 6 (programmatic click chain): click `Continue`. Expected (Smart/Strict): prompt "Blocked new tab" for `example.org/?forced=1`.
- Level 7 (legit modal backdrop): should not be blocked; debug overlay should show low CDS.
- Level 8 (legit OAuth popup): likely prompts (NavSentinel can't know it's OAuth yet); allow once should open it.
- Level 9 (legit video overlay controls): should not be blocked.
- Level 10 (redirects/forms): `Immediate redirect` should navigate; delayed redirect should auto-roll back and offer a proceed prompt; delayed submit should prompt.

Explicit intent checks:
- Ctrl/Cmd+click or middle-click should set `ExplicitNewTab: yes` in the debug overlay and allow the open without prompting.

## Known gaps
- Level 2 can be inconsistent on some machines (no prompt, no navigation). If you see this, try moving the mouse after page load before clicking. If it still does nothing, log it as a known issue.
- Same-tab redirects via `location.assign/replace` are not reliably interceptable in Chrome because `window.location.assign` is non-writable/non-configurable. Level 10 delayed redirect will navigate; the rollback auto-back + prompt is the backstop.
- The baseline DNR ruleset is conservative and Gym-focused (matches only a couple of demo URLs). Expand carefully if you need real-world coverage.

## Debugging tips
- After rebuilding, click `Reload` for the extension in `chrome://extensions`.
- Confirm the main-world patch is running: open DevTools Console on a Gym page and check `window.__navsentinelMainGuard === true`.
- With debug enabled, use the live overlay (`MainGuard`, `Decision`, `CDS`, `Reasons`) and the page console logs (`[NavSentinel] click`, `[NavSentinel] blocked`, `[NavSentinel] allowance`).
- `Decision: prompt` indicates a navigation prompt, while `Decision: block` indicates a hard block.
- If `MainGuard: no`, `window.open` / redirects cannot be reliably blocked (only `_blank` click capture will work).

## E2E test (Playwright)
1. Build the extension: `npm run build`.
2. Run: `npm run test:e2e` (starts a temporary local Gym server automatically).

Optional env vars:
- `EXTENSION_PATH` (defaults to `extension/dist`)
- `GYM_BASE_URL` (if set, uses your running Gym server instead)
- `ROLLBACK_E2E=1` (enables the Level 10 redirect rollback test)
- `LIVE_E2E=1` (enables live-web test against Google search results)

## Automated tests
- Unit tests: CDS scoring and reason codes (Vitest + JSDOM).
- E2E tests: Playwright against Gym (assert no unwanted new tabs).
- Multi-popup test: one click -> multiple opens (auto-block extras).
- Performance: basic click budget checks (no DOM polling, minimal style reads).

## Debug workflow
- Use DevTools event listener breakpoints for click handlers.
- Log reason codes and last gesture context for each decision.
