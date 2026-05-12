---
name: ns-ext-dev
description: Extension development workflow for NavSentinel. Use when adding features, fixing bugs, or changing runtime behavior in the Chrome MV3 extension.
user-invocable: true
---

# NavSentinel Extension Development

Use this when the task changes extension runtime behavior.

## Change Surface Map

From `CONTRIBUTING.md` and `autodoc/AGENT_INDEX.md`:

- navigation scoring and click decisions: `extension/src/content/capture_isolated.ts`, `extension/src/shared/scoring.ts`, `extension/src/shared/nrs.ts`
- main-world popup, redirect, form, clipboard, and opener enforcement: `extension/src/content/main_guard.ts`
- credential risk and prompts: `extension/src/content/credential_guard.ts`, `extension/src/content/credential_modal.ts`, `extension/src/shared/domain.ts`
- storage and persistence: `extension/src/shared/storage.ts`, `extension/src/shared/allowlist.ts`, `extension/src/shared/session_state.ts`
- popup and options UI: `extension/src/popup/*`, `extension/src/options/*`
- rollback, OAuth, DNR, redirect chains, and session-backed SW state: `extension/src/sw/sw.ts`

## Build And Verify Cycle

1. `npm run typecheck` for type safety.
2. `npm run build` to bundle to `extension/dist/`.
3. Reload the extension in `chrome://extensions` for manual checks.
4. `npm run test` for unit tests.
5. Targeted Playwright E2E for behavior that only exists in a browser.

Use `npm run watch` during development for automatic rebuilds.

## Gym Testing

- Start the Gym: `npm run gym:serve`.
- Primitive levels cover navigation, overlays, OAuth, credential, and redirect cases.
- Real-world `rw*` pages cover realistic attack and false-positive scenarios.
- Evasion, ClickFix, DoubleClickjacking, corpus, stress, rollback, and live lanes have separate configs where needed.

## Guardrails

- Keep logic local; no remote calls or telemetry.
- Content scripts must not exfiltrate data.
- Main-world patching must be minimal and defensible.
- Respect MV3 service-worker lifecycle constraints.
- Preserve deterministic test hooks unless tests are updated in the same change.
