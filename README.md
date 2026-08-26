# NavSentinel

> **Pre-alpha; not yet validated, distributed, or adopted.** `NavSentinel` is a
> working name pending clearance. See
> [`docs/Product_Strategy.md`](docs/Product_Strategy.md) for the current product
> thesis, release blockers, and evidence gates.

NavSentinel is a local-first Chrome MV3 extension that hardens several abuse-heavy browser surfaces:

- deceptive navigation flows such as hidden overlays, popunders, retargeted clicks, delayed redirects, and synthetic popup attempts
- risky credential submissions such as HTTP password posts, lookalike domains, untrusted domains, and suspicious cross-site form actions
- DoubleClickjacking attacks that hijack a double-click gesture to land on sensitive buttons (OAuth consent, MFA, payment)
- ClickFix / fake CAPTCHA overlays that write malicious commands to the clipboard and instruct users to paste them
- an interaction-only default profile with no reputation runtime, asset, or
  claim; a separate unpacked-only research profile retains the deterministic
  reserved-domain bloom fixture for local experiments

The current `main` branch contains the merged suite baseline: navigation and
credential guards, popup/options surfaces, trusted-domain management, and a
bounded local event log. "Implemented" here does not mean efficacy-validated,
externally audited, or released.

## What it does

- Scores clicks with a Click Deception Score (CDS) before allowing navigation side effects.
- Optionally suppresses classifier-identified high-severity foreground overlays
  after injection or an already-blocked click, shows an Undo action, and never
  replays the intercepted click.
- Patches `window.open` and form submission in the main world to catch
  script-driven navigation before it commits. `location.assign` /
  `location.replace` are *not* patched and cannot be: Chromium exposes them as
  non-writable, non-configurable own methods of each `Location`, so a page
  script can neither replace them nor interpose on an ordinary call. Some of
  those navigations are recovered after the fact by the service worker's
  rollback layer, but only some: it rolls back a top-frame redirect to a
  *different* registrable domain when no gesture allowance covers it. A script
  redirect that stays on the same registrable domain and follows no recent user
  navigation is deliberately left alone, to avoid fighting the in-site redirects
  ordinary websites depend on. The full condition list is in
  [`docs/Architecture_and_Data_Flow.md`](docs/Architecture_and_Data_Flow.md).
- Uses a MessagePort bridge for steady-state isolated/main-world control
  traffic. Its challenge verifies port possession/liveness, not a hard
  authenticated identity boundary; #175/#186 remain unlisted-beta gates.
- Intercepts password-form submission and computes local credential risk before allowing the submit.
- Detects DoubleClickjacking attack patterns across main-world, isolated-world, and service-worker layers.
- Detects ClickFix / fake CAPTCHA overlays that combine clipboard writes with deceptive instruction text.
- Emits a deterministic build-profile receipt. Release packages are accepted
  only from the interaction-only profile; the reputation research build is
  explicitly non-release and cannot be packaged by `package:ext`.
- Stores bounded local configuration, decision history, prompt outcomes, and
  behavioral profiles in `chrome.storage.local`; see `PRIVACY.md` for the full
  inventory, export gaps, and deletion controls.
- Provides a popup for the current tab and an options page for persistent configuration, import/export, and log review.

## Effective usage

Use this repository build only for controlled development and dogfooding until
the beta gates pass. Do not rely on it as a sole security control. In particular,
RI-01 must move every protection-lowering decision into extension-origin UI
bound to the intended tab/destination; page-injected UI cannot safely authorize
proceed/allow/trust/resume even with trusted-event checks. RI-02 has removed the
non-functional viewport-capture path; its required Gate-3 closeout remains before
the release-integrity blocker can close.

### Navigation protection modes

- `Off`: no intervention; useful only for debugging or side-by-side comparisons.
- `Smart`: recommended default. Blocks clearly deceptive interactions while allowing ordinary navigation and most legitimate `_blank` links.
- `Strict`: lowers the block threshold and is better for adversarial testing in the Gym.

### Credential protection modes

- `Off`: disables password submit prompting and paste warnings.
- `Smart`: recommended default. Prompts on untrusted domains and medium/high risk submits.
- `Strict`: prompts more aggressively and is the better mode when testing phishing-style scenarios.

### Trusted domains vs navigation allowlist

- Trusted domains are for password-submit decisions. Add domains you genuinely trust to receive credentials.
- The navigation allowlist is per-site and per-destination host. It is for flows you intentionally permit after a navigation block or prompt.
- Do not treat them as the same control. A site can be safe to open in a new tab without being a trusted destination for password submission.

### Recommended workflow

1. Start in `smart` navigation mode and `smart` credential mode.
2. Use the popup on a live page to inspect the current registrable domain, trust state, and recent events.
3. Use the options page to tune thresholds, inspect the allowlist, and export/import settings.
4. Use the Gym to validate changes before trusting behavior on the open web.
5. Switch to `strict` while developing new heuristics or new Gym levels.

## Repo layout

- `extension/`: MV3 source, manifest, assets, and build output
- `gym/`: deterministic HTML fixtures for navigation and credential scenarios
- `tests/`: Vitest unit tests and Playwright E2E specs
- `docs/`: architecture, threat model, testing, release, roadmap, and redesign docs
- `scripts/`: release/profile checks, research bloom builds, benchmarks, and data updates
- `autodoc/`: agent-facing code orientation index

## Build and run

```bash
npm install
npm run build
```

Load `extension/dist` in `chrome://extensions` with Developer Mode enabled.
`npm run build` always selects the release-eligible `interaction-only` profile.
For a local unpacked experiment only, `npm run build:research-reputation`
enables the reserved-domain fixture and marks the artifact non-release.

Useful commands:

```bash
npm run watch
npm run test
npm run test:e2e
npm run demo:showcase
npm run demo:showcase:record
npm run typecheck
npm run verify:versions
npm run package:ext
npm run gym:serve
```

## Using the extension

### Popup

The popup is the fastest control surface for the current tab. It lets you:

- see the active registrable domain
- see whether that domain is trusted for credential submits
- trust or untrust the current domain
- switch nav mode and credential mode
- inspect the latest event entries
- jump into the full options page

### Options page

The options page is the durable operator view. It lets you:

- configure navigation mode and debug overlay
- configure credential prompts, paste warnings, medium-risk threshold, and lookalike sensitivity
- tune the event log ring-buffer size
- inspect and clear the navigation allowlist
- manage the trusted-domain list
- export and import the full local configuration bundle

### Gym

The Gym provides deterministic fixtures for attack and edge-case patterns:

- Levels 1-12: overlay, retargeting, popunder, programmatic click, delayed redirects, credential prompts, and legitimacy edge cases
- DoubleClickjacking: basic, OAuth consent, payment, and legitimate double-click variants
- ClickFix: fake CAPTCHA, clipboard hijack, Win+R instructions, and real CAPTCHA contrasts
- Redirect chains: direct, shortener, deep chains, and legitimate redirect flows
- Content fingerprinting: brand mismatch, phishing kit, and legitimate login pages
- DOM mutation: delayed overlay, form action change, password injection variants
- PushState abuse, evasion composites, CSP/SRI scenarios, and real-world adversarial fixtures (RW-01 through RW-25)

Start it with:

```bash
npm run gym:serve
```

Then open `gym/index.html` through the local server.

## Testing

- `npm run test`: unit tests for local heuristics and shared logic
- `npm run test:e2e`: Playwright suite scoped to `tests/e2e/**/*.spec.ts`
- `npm run demo:showcase`: guided headed demo using the stable `core` variant
- `npm run demo:showcase:record`: same core variant with video capture by default, plus optional trace capture via `--trace`
- `npm run demo:showcase:operator`: popup/options heavy walkthrough using the real popup surface
- `npm run demo:showcase:recovery`: redirect/recovery-prompt focused guided variant
- `npm run typecheck`: strict type verification

For custom demo runs:

- `node scripts/run_demo.mjs core --fast`
  - shorter waits for editing and dry runs
- `node scripts/run_demo.mjs core --record --trace`
  - record mode plus an explicit Playwright trace artifact

The Playwright config intentionally limits discovery to E2E specs so Vitest files are not loaded by the Playwright runner.

## Privacy and security posture

- No remote telemetry
- No reputation lookup in the default interaction-only build
- No runtime network lookup in the opt-in reputation research build
- No password-value storage
- Clipboard content is inspected transiently in the page's MAIN world to derive
  metadata for ClickFix detection; the content is not bridged, stored, or
  transmitted
- Local-only settings and logs

See:

- `docs/README.md`
- `PRIVACY.md`
- `SECURITY.md`

## Documentation map

Start with `docs/README.md`. The most useful follow-on docs are:

- `docs/Project_Overview.md`
- `docs/Product_Strategy.md`
- `docs/Architecture_and_Data_Flow.md`
- `docs/Intent_Model_and_Scoring.md`
- `docs/Testing_and_Gym.md`
- `docs/Real_World_Adversarial_Program.md`
- `docs/RELEASING.md`

Historical merge-era context lives under:

- `docs/archive/README.md`
