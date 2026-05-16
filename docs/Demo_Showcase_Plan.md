# Demo Showcase Plan

## Purpose

Define a watchable automated demo for NavSentinel that stays close to the existing headed Playwright
flow, but is optimized for human viewing rather than only for pass/fail verification.

The demo program should cover:

- deceptive navigation blocking
- legitimate-navigation allowance
- credential-submit interruption
- trust persistence
- popup and options operator surfaces
- local event-log visibility

## Variant plan

The demo work is split into named variants so one run does not try to explain every product surface
at once.

### `core`

The concise, stable guided walkthrough.

Targets:

- representative blocked navigation
- representative legitimate allowance
- credential-submit interruption
- trust persistence
- options-page evidence
- deterministic record mode

### `operator`

A popup/options heavy walkthrough.

Targets:

- real popup-surface automation
- mode changes from the popup
- trust-state visibility in the popup
- options import/export or richer state inspection when useful

### `recovery`

A focused chapter set for redirect review and recovery prompts.

Targets:

- redirect intervention
- rollback-style review prompts where they are currently surfaced
- explicit allow-once flows
- bounded replay behavior
- any recovery-specific follow-up copy that would distract from the `core` cut

## Delivery modes

The same runner should support:

- `live`
  - readable pacing for normal demonstration
- `fast`
  - shorter waits for dry runs while editing
- `record`
  - deterministic viewport with optional video and trace capture

## Current status

### Variant progress

| Variant | Status | Notes |
| --- | --- | --- |
| `core` | done | stable merged-main chapter set |
| `operator` | done | real popup-surface automation |
| `recovery` | done | redirect and rollback chapter set |

### Work items

| ID | Item | Status | Notes |
| --- | --- | --- | --- |
| D1 | Add dedicated demo Playwright config | done | foundation for all variants |
| D2 | Add a runner with named variants and record mode | done | owns mode/env wiring |
| D3 | Land the stable `core` showcase | done | uses merged-main fixtures |
| D4 | Add real popup-surface automation | done | shipped in `operator` variant |
| D5 | Add redirect/rollback demo variant | done | shipped in `recovery` variant |
| D6 | Tighten presenter copy and pacing | done | polish applied |

## Current `core` shape

The current `core` cut is intended to stay presentation-stable on merged `main`:

1. Intro slide on `gym/index.html`
2. Level 2 deceptive overlay blocked
3. Level 5 popup blocked
4. Level 12 delayed same-tab navigation allowed
5. Level 9 visible media overlay allowed
6. Level 8 legitimate OAuth popup allowed
7. Level 11 credential submit blocked
8. password paste warning plus trust action
9. options-page evidence
10. closing slide

## Notes

- Keep the `core` cut independent from unmerged or stress-only scenario waves.
- Do not force redirect recovery into `core` if it harms presentation stability.
- Prefer variant-specific cuts over a single oversized demo.
