# Architecture and Data Flow

## Components
- Content script (isolated world): capture-phase event interception, gesture token creation, CDS calculation, and default click blocking.
- Content script (main world, optional): patch navigation primitives before page scripts cache them.
- In-page prompt UI (content script): shadow DOM, high z-index, allow-once/always allow actions.
- Service worker: settings persistence, per-site modes, allowlists, and optional tab-level fallback.
- Options UI: configure modes, view decision reasons, manage allowlists.
- DeclarativeNetRequest (optional): network-layer backstop for main_frame redirects.
- Gym: deterministic demo pages for adversarial and legitimate patterns.

## Execution worlds and frames
- Isolated world is always available and safe for observation and blocking.
- Main world patching is the strongest control path but can be blocked by CSP; design for graceful fallback.
- Content scripts should run with `all_frames: true` to cover iframes.
- Cross-origin frames may not allow injection; use a background fallback (webNavigation) as a last resort for new tab detection.

## Rings of defense
1. Page-world guard (document_start): patch nav primitives and enforce gesture token gating.
2. Click sanitizer (capture phase): detect and neutralize overlay traps; reroute clicks.
3. DNR backstop (optional): block known bad destinations in main_frame.
4. Service worker fallback: close or mark tabs that slip through (last resort).

## Data flow
1. pointerdown and click are captured in the isolated world.
2. Build click context (coords, element stack, visibility hints).
3. Create a short-lived gesture token and compute CDS; cache CDS in the token.
4. On a navigation attempt, compute NRS using CDS + navigation features.
5. Decision: allow, block, or prompt.
6. Only message the service worker when a prompt or allowlist update is needed.
7. Persist per-site rules and allowlists in extension storage.

## Messaging and prompts
- Content script makes the immediate decision; service worker is used for persistence and cross-tab state.
- Prompt UI should include destination URL and allow once or always allow actions.
- Allowlist updates should be applied immediately and broadcast to content scripts.

## Storage and configuration
- `mode`: off | smart | strict
- allowlist: destination or eTLD+1 per site
- thresholds: optional tuning (advanced)
- optional: storage.sync for allowlists (future)

## Performance guardrails
- Do nothing unless a click is likely to trigger navigation.
- Limit expensive reads to the top element and at most one underlying candidate.
- Avoid layout thrash; use getBoundingClientRect and elementsFromPoint only when needed.
- Avoid service worker round trips except for prompts and persistence.
