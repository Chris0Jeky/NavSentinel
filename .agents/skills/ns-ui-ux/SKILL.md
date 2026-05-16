---
name: ns-ui-ux
description: NavSentinel UI workflow for popup, options, onboarding, prompts, risk explanations, and accessibility.
user-invocable: true
---

# NavSentinel UI UX

Surfaces: popup, options, `ui_toast.ts`, `credential_modal.ts`, and onboarding if added.

Rules: keep UI compact, scan-friendly, extension-appropriate, keyboard-accessible, and local-only. Risk copy should say what happened and what action is available. Keep reason codes in technical/debug views when useful.

Verify with `npm run build`, targeted model/unit tests, E2E smoke, or manual extension reload when needed.
