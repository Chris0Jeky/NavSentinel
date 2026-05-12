---
name: ns-ext-dev
description: Extension development workflow for NavSentinel MV3 runtime behavior.
user-invocable: true
---

# NavSentinel Extension Development

Change surfaces:

- navigation decisions: `capture_isolated.ts`, `scoring.ts`, `nrs.ts`
- main-world enforcement: `main_guard.ts`
- credential prompts: `credential_guard.ts`, `credential_modal.ts`, `domain.ts`
- persistence: `storage.ts`, `allowlist.ts`, `session_state.ts`
- popup/options: `extension/src/popup/*`, `extension/src/options/*`
- service worker: `extension/src/sw/sw.ts`

Build/verify: `npm run typecheck`, `npm run build`, `npm run test`, targeted Playwright where browser behavior matters.

Gym: `npm run gym:serve`.

Guardrails: no telemetry, no credential exfiltration, minimal main-world patching, MV3 lifecycle awareness.
