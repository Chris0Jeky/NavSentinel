# Architecture and Data Flow

## Components
- Content script (isolated world): capture-phase event interception, gesture token creation, CDS calculation, and default click blocking.
- Content script (main world, optional): patch navigation primitives before page scripts cache them.
- Service worker: settings persistence, per-site modes, allowlists, and optional tab-level fallback.
- Options UI: configure modes, view decision reasons, manage allowlists.
- DeclarativeNetRequest (optional): network-layer backstop for main_frame redirects.
- Gym: deterministic demo pages for adversarial and legitimate patterns.

## Execution worlds
- Isolated world is always available and safe for observation and blocking.
- Main world patching is the strongest control path but can be blocked by CSP; design for graceful fallback.

## Rings of defense
1. Page-world guard (document_start): patch nav primitives and enforce gesture token gating.
2. Click sanitizer (capture phase): detect and neutralize overlay traps; reroute clicks.
3. DNR backstop (optional): block known bad destinations in main_frame.
4. Service worker fallback: close tabs that slip through.

## Data flow
1. pointerdown and click are captured in the isolated world.
2. Build click context (coords, element stack, visibility hints).
3. Create a short-lived gesture token and compute CDS.
4. On a navigation attempt, compute NRS using CDS + navigation features.
5. Decision: allow, block, or prompt.
6. Persist per-site rules and allowlists in extension storage.

## Storage and configuration
- `mode`: off | smart | strict
- allowlist: destination or eTLD+1 per site
- thresholds: optional tuning (advanced)

## Performance guardrails
- Do nothing unless a click is likely to trigger navigation.
- Limit expensive reads to the top element and at most one underlying candidate.
