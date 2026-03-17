# Architecture and Data Flow

## Extension shape

NavSentinel is a Manifest V3 extension with three main runtime layers:

1. Isolated-world content logic
2. Main-world navigation patching
3. Service-worker state for rollback and DNR synchronization

The manifest wires these together from:

- `extension/manifest.json`
- `extension/src/content/capture_isolated.ts`
- `extension/src/content/main_guard.ts`
- `extension/src/content/credential_guard.ts`
- `extension/src/sw/sw.ts`

## Content-script split

### Isolated-world navigation controller

`extension/src/content/capture_isolated.ts` is responsible for:

- reading settings and allowlist state
- capturing pointer and keyboard click context
- computing the Click Deception Score
- deciding whether to allow, block, or prompt
- showing toasts for blocked or prompted navigation
- coordinating rollback and forward-offer messages with the service worker

This script is where most user-facing navigation decisions are explained.

### Main-world navigation patch layer

`extension/src/content/main_guard.ts` runs in the page's main world so it can patch:

- `window.open`
- `Location.prototype.assign`
- `Location.prototype.replace`
- `HTMLFormElement.prototype.submit`
- `HTMLFormElement.prototype.requestSubmit`

It enforces short-lived gesture allowances and captures blocked actions so the isolated-world script can later allow them explicitly.

### Main/isolated bridge hardening

The bridge uses:

- a per-document random session key
- a protocol version
- an allowlist of accepted message types

This is implemented in:

- `extension/src/content/main_guard.ts`
- `extension/src/content/capture_isolated.ts`

The point is to avoid trusting arbitrary `window.postMessage` traffic from the page itself.

### Credential guard

`extension/src/content/credential_guard.ts` runs in the isolated world and listens for:

- `submit` on forms containing a password field
- `paste` into password inputs

It computes risk through `extension/src/shared/domain.ts` and uses `extension/src/content/credential_modal.ts` to block-and-prompt risky submits.

## Shared state and storage

`extension/src/shared/storage.ts` is the local persistence backbone. It stores:

- suite settings under `sentinelsuite:settings_v1`
- trusted domains under `sentinelsuite:trusted_domains_v1`
- event log under `sentinelsuite:event_log_v1`

It also provides:

- legacy key migration for older NavSentinel settings
- import/export helpers
- bounded event-log append behavior

`extension/src/shared/allowlist.ts` manages the per-site navigation allowlist and migrates the legacy allowlist key when needed.

## Popup and options page

### Popup

`extension/src/popup/popup.ts` is the fast per-tab control surface:

- shows the current registrable domain
- shows whether the current domain is trusted
- allows trusting/untrusting the current domain
- allows switching nav mode and credential mode
- shows the most recent event entries

### Options page

`extension/src/options/options.ts` is the full operator surface:

- save settings for nav mode, debug overlay, and DNR backstop
- save credential-guard thresholds and similarity rules
- inspect and clear the navigation allowlist
- manage trusted domains
- refresh, clear, export, and import event-log state

## Service worker responsibilities

`extension/src/sw/sw.ts` maintains short-lived browser state that cannot live in the page:

- tab-scoped allowance TTLs
- rollback suppression windows
- pending rollback and forward-offer state
- DNR ruleset enable/disable sync

It listens to `chrome.webNavigation.onCommitted` to detect redirect-like navigations that were not allowed by an explicit user gesture.

## Data flow examples

### Deceptive click to new tab

1. `capture_isolated.ts` captures the click context and computes CDS.
2. The main-world patch layer traps the actual popup/navigation side effect.
3. If the destination is suspicious and not allowlisted, the isolated-world script shows a toast prompt.
4. "Allow once" sends a short-lived allowance and replays the blocked action.
5. "Always allow" records the destination host in the per-site allowlist, then replays it.

### Risky credential submit

1. `credential_guard.ts` intercepts the form submit before it completes.
2. `domain.ts` computes risk and reason codes.
3. `credential_modal.ts` displays a blocking modal with the page domain, destination domain, score, and reasons.
4. The user can cancel, proceed once, or trust a relevant domain.
5. `storage.ts` records the event locally.

### Auto-rollback of redirect

1. `sw.ts` sees a committed redirect-like navigation without an active allowance.
2. It stores rollback metadata per tab.
3. `capture_isolated.ts` receives or polls the rollback state.
4. It returns the tab to the previous page when possible and shows a "Proceed" prompt for the original destination.

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
