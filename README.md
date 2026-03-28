# NavSentinel

NavSentinel is a local-first Chrome MV3 extension that hardens two abuse-heavy browser surfaces:

- deceptive navigation flows such as hidden overlays, popunders, retargeted clicks, delayed redirects, and synthetic popup attempts
- risky credential submissions such as HTTP password posts, lookalike domains, untrusted domains, and suspicious cross-site form actions

The current `main` branch ships the merged suite baseline. That means the extension now includes the navigation firewall, the credential guard, a popup, a full options page, trusted-domain management, and a bounded local event log.

## What it does

- Scores clicks with a Click Deception Score (CDS) before allowing navigation side effects.
- Patches `window.open`, `location.assign`, `location.replace`, and form submission in the main world to catch script-driven navigation.
- Relays isolated-world and main-world control messages through the extension runtime instead of page-visible `window.postMessage` traffic.
- Intercepts password-form submission and computes local credential risk before allowing the submit.
- Stores only local settings, allowlists, trusted domains, and a bounded event log in `chrome.storage.local`.
- Provides a popup for the current tab and an options page for persistent configuration, import/export, and log review.

## Effective usage

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
- `tests/`: Vitest unit tests and Playwright E2E tests
- `docs/`: architecture, threat model, testing, release, and usage docs
- `scripts/`: release and verification scripts

## Build and run

```bash
npm install
npm run build
```

Load `extension/dist` in `chrome://extensions` with Developer Mode enabled.

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

- configure navigation mode, debug overlay, and the experimental DNR backstop
- configure credential prompts, paste warnings, medium-risk threshold, and lookalike sensitivity
- tune the event log ring-buffer size
- inspect and clear the navigation allowlist
- manage the trusted-domain list
- export and import the full local configuration bundle

### Gym

The Gym gives you deterministic fixtures for common attack and edge-case patterns:

- Levels 1-9: overlay, retargeting, popunder, programmatic click, and legitimacy edge cases
- Level 10: delayed redirects and form submits
- Level 11: risky password-submit prompt coverage
- Level 12: slow same-tab navigation legitimacy coverage

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
- `npm run typecheck`: strict type verification

For custom demo runs:

- `node scripts/run_demo.mjs core --fast`
  - shorter waits for editing and dry runs
- `node scripts/run_demo.mjs core --record --trace`
  - record mode plus an explicit Playwright trace artifact

The Playwright config intentionally limits discovery to E2E specs so Vitest files are not loaded by the Playwright runner.

## Privacy and security posture

- No remote telemetry
- No remote reputation lookups
- No password-value storage
- No clipboard-content capture
- Local-only settings and logs

See:

- `docs/README.md`
- `PRIVACY.md`
- `SECURITY.md`

## Documentation map

Start with `docs/README.md`. The most useful follow-on docs are:

- `docs/Project_Overview.md`
- `docs/Architecture_and_Data_Flow.md`
- `docs/Intent_Model_and_Scoring.md`
- `docs/Testing_and_Gym.md`
- `docs/Real_World_Adversarial_Program.md`
- `docs/RELEASING.md`

Historical merge-era context lives under:

- `docs/archive/README.md`
