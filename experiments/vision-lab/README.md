# NavSentinel · Vision Lab

## Maintained overhaul (2026-09-08)

Run from the **NavSentinel repository root**:

```sh
npm ci
npm run vision:build
npm run vision:start
```

Open `http://127.0.0.1:4318/?mode=desktop`. Browser, Desktop and Relay now have
Forest, Paper and Midnight styles. **Imported evidence** reads the minimized
JSON exported by the real extension's **Protection Center**. Import is explicit;
its history, separate user assessments and export are independent of synthetic
scenarios, extension storage and broker authority.

Saved review packages can also be imported to continue a review, preserving
assessments with their observations. See [review package portability](docs/REVIEW-PACKAGES.md)
for append behavior, validation, and the distinction from protection settings.

For the native shell, stop the standalone service, then:

```sh
npm run vision:desktop:install
npm run vision:desktop
```

Electron 44.2.0 is locked and has been exercised on Windows. It hosts the same
workspace in a sandboxed renderer and owns the broker. It adds no OS interception.

Relay's live request selector now includes two **fixed local counter** fixtures.
Connect with the operator token printed in the service terminal, choose the
review fixture, request, approve, consume, and inspect the independent counter.
Repeat consume: it rejects and the counter stays at one. The auto fixture
demonstrates the small pre-approved contract. External destinations still create
inert receipts; the broker never fetches caller URLs or runs commands. Client
`.local/session.json` contains only client authority, not the operator token.

```sh
npm run vision:test
npm run vision:build
npx playwright install chromium
npm run vision:test:browser
npm run vision:test:desktop
# Build before checking the real disposable test-extension storage/export path:
npm run build
npm run vision:test:extension
```

Current implementation, complete source inventory, evidence and remaining gates:
[overhaul map](../../docs/vision-overhaul/README.md),
[validation](../../docs/vision-overhaul/VALIDATION.md),
[browser acceptance](../../docs/vision-overhaul/BROWSER_ACCEPTANCE.md).

## Original prototype brief (historical, 2026-09-07)

The text below records the supplied bundle before this overhaul. Historical
test counts, native-runtime gaps, token-file details and inert-only execution
claims are superseded by the maintained section and current validation above.

**Three source-grounded, interactive product prototypes.** A browser guardian, a desktop investigation workspace, and a local intent broker for cooperative agents. Built as an isolated experiment, not a replacement for the upstream extension.

## Open the prototypes immediately

Open `START-HERE.html`, or double-click any of:

| File | Experience |
|---|---|
| `NavSentinel-Browser.html` | Browser guardian, staged page, intent decisions, reversible fixture cleanup, trust lists, redacted journal |
| `NavSentinel-Desktop.html` | Protection Center, cross-layer investigation, Data Flow Lens, recovery rehearsal, coverage inventory |
| `NavSentinel-Intent-Relay.html` | Agent contracts, editable policy lab, one-use approval rehearsal, service request console |

Each HTML is self-contained. No package installation, account, API key, CDN, or network connection is needed. Each opens in its intended mode; the top switch also lets you explore the other two. Use **Run scenario**, **Proving Ground**, and **Ctrl/Cmd + K**. The initial six records are clearly marked example fixtures. There are 20 scenario contracts, including benign and uncertain journeys.

When a browser blocks local storage for file pages, the app stays usable in memory and says so. For one stable shared origin and the actual service, use the loopback studio below.

## Run the actual local intent broker

Requires **Node.js 22 or newer**. There are no root npm dependencies.

```sh
cd NavSentinel-Vision-Lab
node daemon/server.cjs
```

Windows: `START-LAB.cmd`. macOS/Linux: `./START-LAB.sh`.

Open `http://127.0.0.1:4318/?mode=relay`. Choose **Connect broker** and paste the operator token printed by the process. The renderer holds it only in memory. A separate client token is in `.local/session.json`; do not publish that directory.

Try **Requests → send a new-destination request → approve once → consume → consume again**. The first consume creates an inert receipt; the second is rejected. A changed-document attempt also rejects and burns the grant. The service performs **no actual navigation, shell execution, upload, or OS interception**.

In a second terminal:

```sh
node examples/agent.cjs
```

Press Ctrl+C to stop the service. The journal persists; session tokens and pending capabilities do not survive restart. Ports can be changed with `PORT` and `LAB_PORT`. Access the server as `127.0.0.1`, not `localhost`: the Host boundary is intentionally exact.

## Try the real experimental MV3 extension

1. Use a dedicated Chrome testing profile. Open the browser’s extensions management page and enable Developer mode.
2. Choose **Load unpacked**, selecting this bundle’s `extension` folder. No extension build step is needed.
3. Start the Node service. Visit `http://127.0.0.1:4319`. Open the extension toolbar popup, choose **Enable on this site**, then reload the fixture page.
4. Compare the inert sink counters with the guard off and on. Use the extension popup for **Undo this cleanup** and **Allow once**, never a page-injected prompt.

This is a new experimental guard, **not the original repository’s build**. It contains real source paths for opt-in DOM sensing, selected captured click/submit interception, bounded transparent-layer cleanup, and trusted extension-origin actions. It does not provide broad production browser or OS protection. The programmatic-submit fixture deliberately demonstrates a remaining gap.

Managed browser policies in the build environment prevented installing the extension and visiting loopback URLs. **No live-extension pass is claimed.** See `docs/MANUAL-BROWSER-GATE.md` and the environment-blocked receipt under `artifacts/`.

## Optional native desktop window

The desktop UI works immediately as HTML. A native Electron shell is also included:

```sh
# First stop the standalone service, which uses the same ports.
cd desktop
npm install
npm start
```

Electron is pinned to 44.2.0, verified against the official release index on 2026-09-07. The shell owns the loopback service, uses a sandboxed/context-isolated renderer, validates a narrow IPC surface, and keeps the operator token in the main process. It does not install system hooks or a background OS service. Its dependency was **not installed or executed** in this environment. No signed installer is supplied. Retain the npm-generated lockfile after validating installation locally.

## Test and rebuild

```sh
npm test
npm run build
```

The Node tests need no dependencies. The build regenerates the three standalone HTML files and copies the portable kernel into the extension. Keep generated files in sync with source.

Optional browser checks require Python Playwright and a Chromium executable:

```sh
python tests/ui_smoke.py
python tests/live_extension.py
```

The UI harness uses in-memory documents and explicitly substitutes storage/transport under managed-browser restrictions. Its 52 checks are not a claim of native Electron or extension execution. `tests/live_extension.py` respects administrator policy, starts its own ephemeral fixture server, and reports infrastructure limitations instead of mislabeling them as passes. It is intended for an unmanaged local testing machine. Set `CHROMIUM_PATH` where necessary.

## What is included

`docs/SHOWCASE.md` provides demonstration routes. `docs/REALITY-MAP.md` separates working logic, replay, source-only native adapters, and absent capabilities. `docs/ARCHITECTURE.md` describes trust boundaries, stores, budgets and deployment. `docs/SOURCE-GROUNDING.md` maps design choices to inspected source, issues and milestones. `docs/AGENT-HANDOFF.md` is a review-first integration brief for the upstream repository agent. `artifacts/VALIDATION.md` records exactly what was and was not exercised.

The bundle does not change the GitHub repository, reorder its milestones, or waive release/privacy/browser gates. A fixture match is not a detection-rate measurement, and no security score is presented as a probability.
