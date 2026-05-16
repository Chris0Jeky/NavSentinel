# JS Behavior Analysis - Architecture Design (P4-02)

## Overview

JavaScript Behavior Analysis adds runtime monitoring of page scripts to detect credential exfiltration and suspicious form manipulation patterns. This targets attacks that:

1. **Form submit handler hijacking** - Attacker JS attaches submit handlers that POST form data (including credentials) to unexpected third-party endpoints instead of or in addition to the legitimate form action.
2. **Clipboard-based credential exfiltration** - Scripts that read password field values and exfiltrate them via clipboard APIs (complementing the existing clipboard write detection in ClickFix).
3. **Credential field value reads** - Monitoring access to `HTMLInputElement.prototype.value` on password/sensitive fields to detect unauthorized reads by injected scripts.
4. **Beacon/fetch exfiltration during form submission** - Scripts that fire `fetch()`, `XMLHttpRequest`, or `navigator.sendBeacon()` to third-party domains during/around form submission, leaking credentials to attacker infrastructure.

These attacks are common in compromised WordPress sites, Magecart-style skimming, and browser extension supply-chain attacks where malicious JS is injected into legitimate pages.

## Architecture

### Execution Context

Like the existing `main_guard.ts`, the JS behavior monitor patches run in the **main world** (via the `world: "MAIN"` content script entry in manifest.json). This is required because:

- Intercepting `HTMLInputElement.prototype.value` getters requires prototype patching in the page's own JS context.
- Monitoring `fetch()`/`XHR`/`sendBeacon()` at the call site requires main-world access.
- Form submit event metadata needs the real form element reference.

### Signal Flow

```
[Main World: js_behavior_monitor.ts]
    |
    | (postToIsolated via MessagePort bridge)
    v
[Isolated World: capture_isolated.ts]
    |
    | (NRS factor integration)
    v
[Scoring: nrs.ts - new jsBehaviorScore factor]
    |
    | (chrome.runtime.sendMessage)
    v
[Service Worker: event logging]
```

The monitor emits structured signals over the existing bridge (same `postToIsolated()` helper used by `main_guard.ts`). The isolated world receives these as typed messages and integrates them into the NRS scoring pipeline.

### Integration with Existing Patterns

- **Bridge protocol**: Uses the same `NS_SOURCE`, `PROTOCOL_VERSION`, and `bridgeSession` constants as `main_guard.ts`. The monitor is initialized in the same main-world script, after all existing patches are applied.
- **Scoring integration**: Adds a new `jsBehaviorScore` field to `NavigationContext` in `nrs.ts`, similar to `clickfixScore`. The score is computed from accumulated behavior signals and capped to prevent runaway escalation.
- **Mode awareness**: Respects the `mode` variable (`off`/`smart`/`strict`). When `off`, patches still run (to avoid detectable absence) but signals are not emitted.

### Design Principles

1. **Observe, don't block** - Unlike `main_guard.ts` which blocks `window.open`, behavior analysis is passive. It observes suspicious patterns and feeds them into NRS scoring. Blocking fetch/XHR would break legitimate pages.
2. **Privacy-first** - Never store, log, or transmit actual credential values. Only metadata is captured (field type, destination origin, timing).
3. **Narrow patches** - Each intercepted API is patched with minimal wrapping. The native function is always called; we only observe arguments/timing.
4. **Performance budget** - All monitoring logic must complete within the per-navigation 100ms budget. Heavy analysis is deferred or debounced.

## APIs to Intercept

### 1. Form Submit Monitoring

**Approach**: The existing `main_guard.ts` already applies `hardenProto()` with `writable: false, configurable: false` on `HTMLFormElement.prototype.submit`. Re-patching that method is impossible. Instead, the behavior monitor uses two complementary techniques:

1. **Capturing `submit` event listener** — A capturing-phase listener on `document` observes all form submissions (both user-initiated and programmatic via `requestSubmit()`). This fires before any page-level handlers and cannot be blocked by `stopPropagation` in the bubbling phase.

2. **`HTMLFormElement.prototype.submit` wrapper** — For direct `.submit()` calls (which do not fire the `submit` event), the monitor installs its wrapper *before* `main_guard.ts` hardens the prototype. The wrapper observes and then delegates to the original. This is coordinated via initialization order in `main_guard.ts` (behavior monitor patches first, then `hardenProto()` seals the final state).

**Detection logic** (in both paths):
- Whether the form contains password/credential fields
- Whether the form action points to a cross-origin domain
- Whether the form action was dynamically changed — detected by comparing the live `form.action` against the initial value stored in a `WeakMap<HTMLFormElement, string>` populated at form discovery time (via `MutationObserver`). This avoids property descriptor locking on the form element.

Signal emitted: `ns-js-form-submit-suspicious`

### 2. `fetch()` and `XMLHttpRequest.prototype.send()`

**Approach**: The monitor uses **observe-and-forward wrapping**, not `hardenProto()`. For each API:

1. Save a reference to the original function (e.g., `const originalFetch = window.fetch`).
2. Install a wrapper that observes the call arguments (destination URL, timing) and then unconditionally forwards to the original: `return originalFetch.apply(this, arguments)`.
3. The wrapper does NOT prevent the call, modify arguments, or block on async logic.

This preserves the "observe, don't block" principle. The page (and other extensions) can still wrap these APIs further — our wrapper always delegates, so stacking is safe.

**Detection logic** flags network requests that:
- Fire within a short window (2000ms) of a form submission
- Target a cross-origin destination
- Occur on a page containing credential fields

The monitor does NOT inspect request bodies (privacy). It only logs timing, destination origin, and correlation with form activity.

Signal emitted: `ns-js-exfil-network`

### 3. `navigator.sendBeacon()`

**Approach**: Same observe-and-forward pattern as fetch/XHR. The original `navigator.sendBeacon` is saved, and the wrapper observes then delegates unconditionally. No hardening is applied.

**Rationale for monitoring**: The beacon API is commonly used for exfiltration because:
- It survives page navigation (fire-and-forget)
- It requires no response handling
- It is less likely to be noticed in DevTools

Signal emitted: `ns-js-exfil-beacon`

### 4. `HTMLInputElement.prototype.value` (getter)

**New patch.** Intercepts the property getter on password-type input elements. This detects scripts that read credential field values, which is the prerequisite step for any exfiltration.

To avoid performance impact, the getter patch:
- Only activates on inputs with `type="password"` or fields within a form that has password inputs
- Uses a debounce window (500ms) to avoid flooding on keystroke-driven reads
- Does NOT capture the actual value - only records that a read occurred, the reading call stack depth, and the field type

Signal emitted: `ns-js-credential-read`

## Scoring Model

### New NRS Factor: `jsBehaviorScore`

| Signal | Points | Cap | Condition |
| --- | --- | --- | --- |
| Cross-origin form action on credential form | 15 | 15 | Form has password field AND action is cross-origin to page |
| Dynamic form action change | 10 | 10 | Form action attribute differs from initial HTML value |
| Network exfil during submit | 20 | 20 | fetch/XHR/beacon to 3P within 2s of form submit |
| Beacon to 3P on credential page | 15 | 15 | sendBeacon to cross-origin while password fields present |
| Credential field read by non-form code | 10 | 10 | value getter called outside submit event flow |
| Multiple exfil signals combined | 10 | 10 | 2+ of the above fire within 5s window |

**Total cap: 35 points** (diminishing returns apply above this to prevent single-factor dominance)

The factor is added to `NavigationContext` as:
```typescript
jsBehaviorScore?: number | undefined;
```

NRS integration (in `nrs.ts`):
```typescript
const NRS_WEIGHT_JS_BEHAVIOR_CAP = 35;
// JS behavior signals fire unconditionally (no NRS threshold gate).
// Rationale: these signals detect active credential exfiltration attacks
// that may occur on otherwise-clean pages with no other suspicious indicators.
// Gating behind an NRS threshold (like CSP weakness) would suppress detection
// of the exact attack scenario this monitor targets. This matches the design
// precedent set by clickfixScore, which also fires unconditionally.
if (navCtx.jsBehaviorScore && navCtx.jsBehaviorScore > 0) {
  nrs += Math.min(navCtx.jsBehaviorScore, NRS_WEIGHT_JS_BEHAVIOR_CAP);
  nrsFactors.push("nrs_js_behavior_suspicious");
}
```

### Interaction with Existing Factors

- **ClickFix**: JS behavior signals are independent of ClickFix detection. Both can fire simultaneously (e.g., a ClickFix page that also has credential exfiltration). Like `clickfixScore`, `jsBehaviorScore` fires unconditionally — no NRS threshold gate is required because these signals represent active attacks, not ambient risk modifiers.
- **Known bad domain**: If a page already scores +50 from reputation, JS behavior adds at most 35 more, subject to diminishing returns above 100.
- **Credential guard**: The existing credential guard protects against phishing forms. JS behavior analysis complements it by detecting exfiltration from legitimate forms that have been compromised.

## Performance Constraints

### Budget: < 100ms total per-navigation overhead

| Component | Budget | Strategy |
| --- | --- | --- |
| API wrapping (one-time) | 5ms | Applied once at script injection; form submit wrapper installed before `hardenProto()` seals, network wrappers use observe-and-forward (not hardened) |
| fetch/XHR wrapper per call | 0.1ms | Thin wrapper: check timestamp + destination origin only |
| Form submit inspection | 2ms | Synchronous check of form fields and action attribute |
| Value getter per read | 0.05ms | Type check + debounce guard; no-op if not password field |
| Signal emission | 0.5ms | Async `postToIsolated()` via existing bridge (non-blocking) |
| Scoring integration | 1ms | Simple arithmetic in existing NRS computation path |

### Debouncing Strategy

- **Credential reads**: 500ms debounce per field. A single read event is emitted regardless of how many times `.value` is accessed within the window.
- **Network requests**: 2000ms correlation window after form submit. Only requests within this window are flagged.
- **Beacon calls**: No debounce (beacons are infrequent by nature).
- **Score TTL**: JS behavior score expires after 30s (same as ClickFix state TTL), preventing stale signals from affecting unrelated navigations.

### Memory

- Tracks at most 10 recent form submissions (timestamp + action URL + has-credentials flag).
- Tracks at most 20 recent network requests (timestamp + destination origin).
- Total additional memory: < 2KB per page.

## File Structure

### New Files

| File | World | Purpose |
| --- | --- | --- |
| `extension/src/content/js_behavior_monitor.ts` | Main | API patches and signal emission |
| `tests/js_behavior_monitor.test.ts` | Test | Unit tests for the monitor |

### Existing Files to Modify

| File | Change |
| --- | --- |
| `extension/src/content/main_guard.ts` | Import and call `initJsBehaviorMonitor()` after existing patches |
| `extension/src/content/capture_isolated.ts` | Handle new bridge message types (`ns-js-*`), maintain JS behavior state |
| `extension/src/shared/nrs.ts` | Add `jsBehaviorScore` to `NavigationContext`, add NRS factor |
| `extension/src/shared/scoring.ts` | No changes (CDS is click-geometry only) |
| `autodoc/AGENT_INDEX.md` | Add JS behavior analysis row to Product Seams table |
| `extension/manifest.json` | No changes needed (monitor runs in same main-world script) |

### Build Integration

The monitor module is imported by `main_guard.ts` and bundled into the same main-world content script by Vite. No additional manifest entries or script injections are needed.

## Interface Definitions

```typescript
/** Signal emitted when a form with credentials submits to a suspicious destination. */
export interface JsFormSubmitSignal {
  /** Timestamp of the submit event */
  ts: number;
  /** Whether the form contains password-type inputs */
  hasCredentialFields: boolean;
  /** Whether the form action is cross-origin relative to the page */
  isCrossOrigin: boolean;
  /** Whether the action attribute was dynamically modified */
  actionDynamicallyChanged: boolean;
  /** The destination origin (not full URL, for privacy) */
  destinationOrigin: string;
}

/** Signal emitted when network exfiltration is suspected during form submission. */
export interface JsExfilNetworkSignal {
  /** Timestamp of the network request */
  ts: number;
  /** API used: 'fetch' | 'xhr' | 'beacon' */
  api: "fetch" | "xhr" | "beacon";
  /** Destination origin */
  destinationOrigin: string;
  /** Time since last form submission (ms), or -1 if no recent submit */
  msSinceFormSubmit: number;
  /** Whether password fields are present on the page */
  credentialFieldsPresent: boolean;
}

/** Signal emitted when a credential field value is read. */
export interface JsCredentialReadSignal {
  /** Timestamp of the read */
  ts: number;
  /** Input field type (always 'password' in initial implementation) */
  fieldType: string;
  /** Whether the read occurred during a form submit event */
  duringSubmit: boolean;
}

/** Aggregated JS behavior state tracked in the isolated world. */
export interface JsBehaviorState {
  /** Computed score for NRS integration (0 to NRS_WEIGHT_JS_BEHAVIOR_CAP) */
  score: number;
  /** Timestamp of last signal received */
  lastSignalTs: number;
  /** Individual signal counts within the current TTL window */
  signalCounts: {
    formSubmitSuspicious: number;
    exfilNetwork: number;
    exfilBeacon: number;
    credentialRead: number;
  };
}
```

## Security Considerations

1. **No value storage**: The monitor never stores, logs, or bridges actual field values. Only boolean flags and metadata are transmitted.
2. **Origin-only destinations**: Network request destinations are reduced to origin (protocol + host + port) before bridging. No paths, query params, or bodies.
3. **Debounce prevents fingerprinting**: The debounce logic prevents pages from using the value getter timing to detect NavSentinel's presence.
4. **Patch detection resistance**: Network API wrappers use observe-and-forward (not `hardenProto()`), which is intentional — hardening network APIs would break the "observe, don't block" principle. Form submit monitoring is protected by the existing `hardenProto()` seal on `HTMLFormElement.prototype.submit` (the behavior wrapper is installed first, then hardened together with the navigation guard). The `value` getter patch on `HTMLInputElement.prototype` uses `Object.defineProperty` with `configurable: false` to resist removal.
5. **No exfiltration of user data**: The extension itself never makes network calls. All signals stay local (bridge -> NRS -> storage).

## Open Questions (for implementation slices)

1. Should `XMLHttpRequest` monitoring include `open()` (to capture the URL) or just `send()` (to capture timing)? **Decision: patch both - `open()` records the URL, `send()` records the timing and correlates.**
2. Should the value getter patch apply to all input types or only `type="password"`? **Decision: start with password only; expand to email/tel in a follow-up if false-negative rate is high.**
3. Should the monitor detect `document.querySelector` targeting password fields? **Decision: defer - too broad, high false-positive risk from legitimate form libraries.**

## Implementation Slices

1. **Slice 1** (this PR): Architecture design + stub interfaces + AGENT_INDEX update.
2. **Slice 2**: Implement form submit monitoring (cross-origin action detection, dynamic action change).
3. **Slice 3**: Implement fetch/XHR/beacon monitoring with correlation logic.
4. **Slice 4**: Implement credential field value getter monitoring.
5. **Slice 5**: Integrate scoring into NRS, add to isolated-world handler.
6. **Slice 6**: Unit tests + gym fixtures for each signal type.
7. **Slice 7**: E2E tests with Playwright verifying end-to-end signal flow.
