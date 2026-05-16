---
name: ns-ui-ux
description: NavSentinel UI workflow for popup, options, onboarding, prompts, risk explanations, and accessibility.
user-invocable: true
---

# NavSentinel UI UX

Use when changing user-visible extension UI or copy.

## Surfaces

- popup: `extension/src/popup/*`
- options page: `extension/src/options/*`
- navigation toast: `extension/src/content/ui_toast.ts`
- credential modal: `extension/src/content/credential_modal.ts`
- onboarding, if added later: `extension/src/onboarding/*`

## Rules

- Keep UI compact, scan-friendly, and extension-appropriate.
- Prefer clear actions over explanation-heavy panels.
- Risk copy should tell the user what happened and what action is available.
- Keep reason codes available for technical/debug views when useful.
- Preserve keyboard accessibility, focus behavior, and readable contrast.
- Do not introduce remote assets or telemetry.

## Verification

- `npm run build`
- targeted unit/E2E for popup/options/model behavior
- manual extension reload when interaction cannot be covered cheaply

## Output

- changed UI surface
- user-facing behavior change
- verification and remaining manual check, if any
