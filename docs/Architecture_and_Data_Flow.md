# Architecture and Data Flow

## Runtime layers

NavSentinel is a Manifest V3 extension with four main runtime surfaces:

1. isolated-world navigation control
2. main-world navigation patching
3. isolated-world credential protection
4. service-worker state for rollback and DNR synchronization

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
- computing CDS and deciding whether to allow, block, or prompt
- showing blocked/prompt toasts
- coordinating rollback and forward-offer flow with the service worker

This is the main user-facing navigation decision surface.

### Main-world patch layer

`extension/src/content/main_guard.ts` runs in the page's main world so it can patch browser-facing primitives that isolated-world code cannot safely override:

- `window.open`
- `Location.prototype.assign`
- `Location.prototype.replace`
- `HTMLFormElement.prototype.submit`
- `HTMLFormElement.prototype.requestSubmit`

It captures blocked or replayable navigation attempts and hands control back to the isolated-world logic.

### Credential guard

`extension/src/content/credential_guard.ts` listens for:

- `submit` on forms containing a password field
- `paste` into password inputs

It computes risk through `extension/src/shared/domain.ts` and uses `extension/src/content/credential_modal.ts` to block-and-prompt risky submits.

## Main/isolated bridge

The main/isolated bridge is intentionally split into two phases:

1. isolated world generates a per-document bridge session and initiates the handoff
2. steady-state traffic flows over `MessageChannel` / `MessagePort`

The important constraints are:

- messages must carry the NavSentinel source marker
- messages must match the current protocol version
- messages must match the current per-document session
- only a narrow allowlist of bridge message types is accepted

This keeps actionable control traffic off the old page-visible `window.postMessage` path and makes the bridge state far less spoofable than the earlier fallback design.

## Shared state and storage

`extension/src/shared/storage.ts` is the local persistence backbone. It stores:

- suite settings under `sentinelsuite:settings_v1`
- trusted domains under `sentinelsuite:trusted_domains_v1`
- event log under `sentinelsuite:event_log_v1`

It also provides:

- legacy NavSentinel settings migration
- trusted-domain normalization to registrable domains
- import/export helpers
- bounded event-log behavior based on `logLimit`

`extension/src/shared/allowlist.ts` manages the per-site navigation allowlist, including legacy key migration and normalization.

## Popup and options page

### Popup

`extension/src/popup/popup.ts` is the fast per-tab control surface:

- shows the current registrable domain
- shows whether that domain is trusted
- allows trusting or untrusting the current domain
- switches nav mode and credential mode
- shows recent event entries

### Options page

`extension/src/options/options.ts` is the durable operator surface:

- saves nav mode, debug overlay, and DNR backstop state
- saves credential thresholds and similarity settings
- inspects and clears the navigation allowlist
- manages trusted domains
- refreshes, clears, exports, and imports event-log state

## Service worker responsibilities

`extension/src/sw/sw.ts` owns short-lived browser state that cannot safely live in a page:

- tab-scoped allow TTLs
- gesture TTLs
- one-shot target allowances
- rollback suppression windows
- pending rollback and forward-offer state
- DNR ruleset enable/disable synchronization

It listens to `chrome.webNavigation` events to decide when a committed navigation should be treated as legitimate, rolled back, or offered back to the user.

## Data flow examples

### Suspicious popup or `_blank` navigation

1. `capture_isolated.ts` captures the click context and computes CDS.
2. `main_guard.ts` traps the popup or navigation side effect.
3. If the destination is suspicious and not allowlisted, the isolated-world script shows a toast prompt.
4. Allow-once sends a short-lived allowance and replays the blocked action.
5. Always-allow records the destination host in the per-site allowlist and then replays it.

### Risky credential submit

1. `credential_guard.ts` intercepts the form submit before it completes.
2. `domain.ts` computes score and reason codes.
3. `credential_modal.ts` displays a blocking modal with the page domain, destination domain, score, and reasons.
4. The user can cancel, proceed once, or trust a relevant domain.
5. `storage.ts` records the event locally.

### Redirect rollback

1. `sw.ts` sees a redirect-like top-frame commit without a valid allowance.
2. It stores rollback metadata for that tab and suppresses repeated loops briefly.
3. `capture_isolated.ts` receives or polls the rollback state.
4. The tab is returned to the previous page when possible and the user gets a proceed option for the original destination.

## Test-facing hooks and observability

The extension exposes a small amount of deterministic test state used by the Playwright suite:

- DOM readiness markers for injected controllers
- shadow-root toast rendering
- Gym-backed local fixtures for repeatable attacker and legitimate flows

Those hooks are intentional and should stay stable unless the tests are updated in the same change.
