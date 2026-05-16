# NavSentinel Security Audit — Scope & Checklist

**Purpose**: Scoping document for a human-led security audit of NavSentinel before Chrome Web Store submission. Covers the extension's attack surface, trust boundaries, and prioritized review areas.

**Extension type**: Chrome MV3 browser extension for detecting interaction-level attacks
**Permissions**: `storage`, `declarativeNetRequest`, `declarativeNetRequestWithHostAccess`, `webNavigation`, `tabs`, `host_permissions: <all_urls>`

---

## Trust Boundaries

### 1. MAIN World ↔ Host Page (highest risk)

`main_guard.ts` runs in the page's MAIN world at `document_start`. It patches browser APIs and exposes state to the page.

**Patches applied to page globals:**
- `Window.prototype.open` / `window.open`
- `Location.prototype.assign` / `Location.prototype.replace`
- `HTMLFormElement.prototype.submit` / `.requestSubmit`
- `History.prototype.pushState` / `.replaceState`
- `navigator.clipboard.writeText` / `.write`
- `document.execCommand`
- `window.opener` (replaced with Proxy — conditional: only when `window.opener` is non-null, i.e. child/popup windows)

**Globals readable by page scripts (always present, not gated on debug mode):**
- `window.__navsentinelMainGuard` (boolean — signals MAIN world script ran)
- `window.__navsentinelLocationPatch` (object — written unconditionally in `patchLocation()` at `main_guard.ts:528`; exposes 6 properties: `protoAssign` (bool — did `Location.prototype.assign` patch succeed?), `protoReplace` (bool — did `Location.prototype.replace` patch succeed?), `locAssign` (bool — does `window.location.assign` point to the patch?), `locReplace` (bool — does `window.location.replace` point to the patch?), `locAssignDesc` (`{configurable, writable}|null` — descriptor for `window.location.assign`), `locReplaceDesc` (`{configurable, writable}|null` — descriptor for `window.location.replace`))
- `window.__navsentinelRollbackPrompt` (object — written on each rollback event (`capture_isolated.ts:736`), not debug-gated; contains `{ url, ts }` — only present after at least one rollback on the page)

**DOM attributes readable by page scripts (always present, not gated on debug mode):**
- `document.documentElement.dataset.navsentinelCaptureReady` (`data-navsentinel-capture-ready="1"` set at `capture_isolated.ts:240`) — signals ISOLATED world initialization complete; on `<html>` element with no shadow DOM protection, any page script can detect extension presence
- `document.documentElement.dataset.navsentinelBridgeReady` (`data-navsentinel-bridge-ready="1"` set at `capture_isolated.ts:168`) — signals bridge is established; on `<html>` element with no shadow DOM protection, any page script can detect extension presence and bridge timing

**Globals readable by page scripts (debug mode only):**
- `window.__navsentinelLastNav` (debug mode only — exposes blocked/allowed status, kind, URL, timing, allow-window state)

**Audit questions:**
- [ ] Can a page save pre-patch API references before `document_start`?
- [ ] Can a page bypass prototype-level patches via `delete` or `__proto__` manipulation?
- [ ] `__navsentinelLocationPatch` leaks patch descriptor state unconditionally — can an attacker use this to determine if patches can be overridden?
- [ ] `__navsentinelRollbackPrompt` leaks the rollback target URL and timestamp unconditionally — is this an information disclosure risk? (Note: ISOLATED world never reads this global back; inbound influence is not a risk, but outbound disclosure is.)
- [ ] Do debug globals (`__navsentinelLastNav`) leak additional security-relevant information when debug is enabled?

### 2. MAIN World ↔ ISOLATED World Bridge

Communication uses `MessageChannel`/`MessagePort` established via a one-time `window.postMessage`.

**Init sequence:**
1. ISOLATED world creates `MessageChannel`, sends `port2` via `window.postMessage("*", [port2])` with a 128-bit random `bridgeSession` token
2. MAIN world validates source, version, session token, and `instanceof MessagePort`
3. Subsequent messages flow over the `MessagePort` pair (not observable by page scripts)

**Audit questions:**
- [ ] Can a page intercept the init `postMessage` before the MAIN world script's `stopImmediatePropagation`?
- [ ] Can a page forge bridge messages by replaying the session token?
- [ ] Are message types validated and bounded at the receiver?
- [ ] Can `ns-allow-action` be replayed to trigger stored navigation callbacks?

### 3. Content Script ↔ Host Page DOM

ISOLATED world scripts inject UI elements into the host page:
- Toast: `#__navsentinel_toast_host` with `attachShadow({ mode: "open" })` (`ui_toast.ts:22`)
- Credential modal: `#__sentinelsuite_cred_modal_host__` with `attachShadow({ mode: "open" })` (`credential_modal.ts:32`)
- Debug overlay: `#__navsentinel_debug_host` with `attachShadow({ mode: "open" })` (`debug_overlay.ts:28`) — host element only exists while debug mode is enabled; removed on `setDebugEnabled(false)`

**Audit questions:**
- [ ] All three shadow roots use `mode: "open"` — page scripts can access them. Can a page auto-click "Always allow" or "Trust this site" buttons?
- [ ] Can a page remove or hide the toast/modal/debug host elements?
- [ ] Can a page inject content into the shadow DOM to spoof warnings?

### 4. Content Script ↔ Service Worker

Communication via `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`. All messages are internal (no externally-connectable).

**Key message types:**
- `ns-allow-nav` — sets per-tab allow window
- `ns-allow-target-nav` — pre-authorises a specific destination URL for up to 10s (`sw.ts:378-390`); sent by `capture_isolated.ts:564` and `main_guard.ts:308`. First-class bypass surface: if a content script can be made to send this with an attacker-chosen URL, the SW permits that navigation.
- `ns-nav-gesture` — records gesture timestamp
- `ns-dblclick-opener-nav` — forwarded from child tab to opener (gated by `childWindowByTab` lookup)
- `ns-reputation-check` — returns bloom filter result
- `ns-begin-rollback` / `ns-rollback` — initiates navigation rollback
- `ns-ready` — marks tab ready, triggers pending rollback delivery
- `ns-tab-risk-update` — content script escalates icon state and block count
- `ns-get-chain-info` — returns redirect chain depth
- `ns-store-forward` / `ns-check-forward` — manages forward navigation offer
- `ns-check-rollback` — returns committed URL state

**Audit questions:**
- [ ] Is `ns-dblclick-opener-nav` properly gated so arbitrary tabs cannot inject false signals?
- [ ] Can timing attacks against `ns-nav-gesture` create false allow windows?
- [ ] Can `ns-allow-target-nav` be abused to pre-authorise attacker-chosen URLs?
- [ ] Are rollback flows safe against races (two tabs triggering rollback simultaneously)?

### 5. Storage

**`chrome.storage.local` (persistent):**
| Key | Content | Sensitivity |
|-----|---------|-------------|
| `sentinelsuite:settings_v1` | Mode, thresholds, debug | Low |
| `sentinelsuite:trusted_domains_v1` | User-trusted registrable domains | Moderate |
| `sentinelsuite:event_log_v1` | Event kind, hostname, score, **url field** (default cap: 300 entries; configurable 50-5000 via `settings.logLimit`) | Moderate — contains full URLs |
| `sentinelsuite:prompt_outcomes_v1` | Domain pairs + outcomes | Moderate |
| `sentinelsuite:nav_allowlist_v1` | Allowlisted site pairs | Moderate |
| `sentinelsuite:adaptive_scores_v1` | Per-domain NRS threshold adjustments | Moderate — fingerprints user behavior per domain |
| `sentinelsuite:smart_default_cooldowns_v1` | Per-domain-pair interaction cooldowns | Low-moderate |
| `sentinelsuite:domain_profiles_v1` | Per-domain avgNRS, visitCount, blockCount, lastSeen | Low-moderate |

**`chrome.storage.session` (ephemeral, cleared on browser close):**
Tab-indexed maps for allow windows, gestures, rollback state, OAuth flow state. Both `allowTarget` and `lastUrlByTab` store full URLs.

**Audit questions:**
- [ ] Can stored data be exfiltrated via a compromised content script?
- [ ] Are storage keys scoped correctly to prevent cross-feature interference?
- [ ] Is the event log bounded? Does the `url` field in `EventLogEntry` store full URLs including paths/query strings?
- [ ] Do `adaptive_scores_v1` and `domain_profiles_v1` create a behavioural fingerprint that could be exfiltrated?

---

## Prioritized Review Areas

### Priority 1 — Critical (must review before CWS submission)

| Area | Files | Risk |
|------|-------|------|
| MAIN world API patches | `main_guard.ts` | Page can potentially bypass or manipulate patches |
| Bridge integrity | `main_guard.ts:629-691` (handleBridgeMessage), `main_guard.ts:750-778` (bridge init listener), `capture_isolated.ts:497-507` | Session token is sole integrity gate |
| Shadow DOM UI security | `ui_toast.ts`, `credential_modal.ts`, `debug_overlay.ts` | `mode: "open"` allows page script access to all three |
| Prototype hardening | `main_guard.ts` (inline `Object.defineProperty` at lines 501-526, 608-626, 1119-1135) | Patches must resist page-initiated override |

### Priority 2 — Important

| Area | Files | Risk |
|------|-------|------|
| SW message handling | `sw.ts` | Tab-gating correctness for cross-tab messages; `ns-allow-target-nav` bypass surface |
| Credential guard | `credential_guard.ts` | Form monitoring and domain trust decisions |
| OAuth flow detection | `capture_isolated.ts`, `dblclick_guard.ts` | Opener manipulation detection correctness |
| Storage data boundaries | `storage.ts`, `allowlist.ts`, `adaptive_scoring.ts`, `domain_profile.ts` | URL retention in event log, behavioral profiling |

### Priority 3 — Nice to have

| Area | Files | Risk |
|------|-------|------|
| Scoring thresholds | `nrs.ts`, `scoring.ts` | False positive/negative rates |
| DNR rules | `rules/dnr_static.json` | Currently test stubs only |
| Build pipeline | `vite.config.ts`, `build-bloom-filter.mjs` | Supply chain, data integrity |
| Unconditional globals | `main_guard.ts` (`__navsentinelLocationPatch`, `__navsentinelRollbackPrompt`) | Info disclosure outside debug mode |

---

## Known Issues to Address Before Audit

1. **`declarativeNetRequestWithHostAccess`** — Permission declared but unused. Remove before submission.
2. **Shadow DOM `mode: "open"`** — Security UI accessible to page scripts across all three injected hosts. Evaluate switching to `mode: "closed"` for toast, credential modal, and debug overlay.
3. **Unconditional globals** — `__navsentinelLocationPatch` and `__navsentinelRollbackPrompt` expose internal state regardless of debug mode. Evaluate gating behind debug flag or removing.
4. **`window.postMessage("*")`** — Bridge init uses `targetOrigin: "*"`. Page scripts can observe the init message (though not intercept the port).
5. **`ns-allow-target-nav` TTL** — Pre-authorises a URL for 10 seconds. If a content script is compromised, attacker can pre-authorise arbitrary navigation targets.

---

## External Dependencies

- No runtime network calls
- No third-party libraries in content scripts (all code is bundled)
- Build-time data: Public Suffix List snapshot, bloom filter from URLhaus/OpenPhish feeds
- Vite + @crxjs/vite-plugin build pipeline

## Audit Deliverables

- [ ] Threat model document
- [ ] Finding report with severity ratings
- [ ] Remediation recommendations
- [ ] Sign-off for CWS submission
