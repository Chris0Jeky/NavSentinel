# Testing and Gym

## Gym purpose
The Gym is a deterministic set of local HTML pages that simulate common malicious and legitimate patterns. It provides a stable target for manual testing and automated E2E tests.

## Gym levels and expected outcomes
- Level 1: invisible overlay anchor (should block with a prompt).
- Level 2: overlay follows mouse (should block with a prompt).
- Level 3: instant injection on pointerdown (should block with a prompt).
- Level 4: visual mimicry (should block with a prompt).
- Level 5: window.open popunder handler (should block with a prompt).
- Level 6: programmatic click chain (should block with a prompt).
- Level 7: legit modal backdrop (should allow).
- Level 8: legit OAuth popup (should prompt or allow).
- Level 9: legit video overlay controls (should allow).
- Level 10: same-tab redirects and form submits (immediate allowed; delayed should prompt).

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

## Per-level walkthrough
- Level 1: click `Play`. Expected: prompt "Blocked new tab" for `example.com`.
- Level 2: move the mouse so the invisible overlay follows it, then click `Real Button`. Expected: prompt "Blocked new tab" for `example.org`.
- Level 3: click `Click me` quickly (the trap exists for ~150ms). Expected: prompt "Blocked new tab" for `example.net`.
- Level 4: click `Download`. Expected: prompt "Blocked new tab" for `example.edu`.
- Level 5: click inside the box. Expected: prompt "Blocked popup" for `example.com/?ad=1`.
- Level 6: click `Continue`. Expected: prompt "Blocked new tab" for `example.org/?forced=1`.
- Level 10: click `Immediate redirect` (should navigate), then click `Delayed redirect (2s)` (should prompt), then `Programmatic form submit (2s)` (should prompt).

## Debugging tips
- After rebuilding, click `Reload` for the extension in `chrome://extensions`.
- Confirm the main-world patch is running: open DevTools Console on a Gym page and check `window.__navsentinelMainGuard === true`.
- With debug enabled, inspect the page console for `[NavSentinel] click` logs and the live overlay for `Decision`, `CDS`, and `Reasons`.

## E2E test (Playwright)
1. Build the extension: `npm run build`.
2. Start the Gym server: `cd gym` then `python -m http.server 5173`.
3. Run: `npm run test:e2e`.

Optional env vars:
- `EXTENSION_PATH` (defaults to `extension/dist`)
- `GYM_BASE_URL` (defaults to `http://localhost:5173`)

## Automated tests
- Unit tests: CDS scoring and reason codes (Vitest + JSDOM).
- E2E tests: Playwright against Gym (assert no unwanted new tabs).
- Multi-popup test: one click -> multiple opens (auto-block extras).
- Performance: basic click budget checks (no DOM polling, minimal style reads).

## Debug workflow
- Use DevTools event listener breakpoints for click handlers.
- Log reason codes and last gesture context for each decision.
