---
name: ns-ext-dev
description: Extension development workflow for NavSentinel. Use when adding features, fixing bugs, or changing runtime behavior in the Chrome MV3 extension.
user-invocable: true
---

# NavSentinel Extension Development

Use this when the task involves changing extension runtime behavior.

## Change surface map

From `CONTRIBUTING.md`:

- navigation scoring and click decisions: `extension/src/content/capture_isolated.ts`, `extension/src/shared/scoring.ts`
- main-world popup/redirect/form enforcement: `extension/src/content/main_guard.ts`
- credential risk and prompts: `extension/src/content/credential_guard.ts`, `extension/src/content/credential_modal.ts`, `extension/src/shared/domain.ts`
- storage and persistence: `extension/src/shared/storage.ts`, `extension/src/shared/allowlist.ts`
- popup and options UI: `extension/src/popup/*`, `extension/src/options/*`
- rollback and DNR sync: `extension/src/sw/sw.ts`

## Build and verify cycle

1. `npm run build` to bundle to `extension/dist/`
2. Reload the extension in `chrome://extensions`
3. `npm run test` for unit tests
4. `npm run typecheck` for type safety
5. `npm run test:e2e` for Playwright E2E (requires extension loaded)

Use `npm run watch` during development for automatic rebuilds.

## Gym testing

- Start the Gym: `npm run gym:serve`
- Levels 1-9: navigation scenarios
- Level 10: delayed redirects and form submits
- Level 11: risky password-submit prompt coverage
- Level 12: slow same-tab navigation legitimacy

## Guardrails

- keep logic local; no remote calls or telemetry
- content scripts must not exfiltrate data
- main-world patching must be minimal and defensible
- test heuristic changes in the Gym, not just unit tests
- respect MV3 service-worker lifecycle constraints