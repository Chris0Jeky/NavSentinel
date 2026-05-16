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
- `window.opener` (replaced with Proxy in child windows)

**Globals readable by page scripts:**
- `window.__navsentinelMainGuard` (boolean)
- `window.__navsentinelLastNav` (debug mode only — exposes blocked/allowed status, kind, URL, timing)
- `window.__navsentinelLocationPatch` (boolean)
- `window.__navsentinelRollbackPrompt` (set by ISOLATED world)

**Audit questions:**
- [ ] Can a page save pre-patch API references before `document_start`?
- [ ] Can a page bypass prototype-level patches via `delete` or `__proto__` manipulation?
- [ ] Do debug globals leak security-relevant information?
- [ ] Can `__navsentinelRollbackPrompt` be set by the page to influence ISOLATED world decisions?

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
- Toast: `#__navsentinel_toast_host__` with `attachShadow({ mode: "open" })`
- Credential modal: `#__sentinelsuite_cred_modal_host__` with `attachShadow({ mode: "open" })`

**Audit questions:**
- [ ] `mode: "open"` shadow roots are accessible to page scripts — can a page auto-click "Always allow" or "Trust this site"?
- [ ] Can a page remove or hide the toast/modal host elements?
- [ ] Can a page inject content into the shadow DOM to spoof warnings?

### 4. Content Script ↔ Service Worker

Communication via `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`. All messages are internal (no externally-connectable).

**Key message types:**
- `ns-allow-nav` — sets per-tab allow window
- `ns-nav-gesture` — records gesture timestamp
- `ns-dblclick-opener-nav` — forwarded from child tab to opener (gated by `childWindowByTab` lookup)
- `ns-reputation-check` — returns bloom filter result
- `ns-begin-rollback` / `ns-rollback` — initiates navigation rollback

**Audit questions:**
- [ ] Is `ns-dblclick-opener-nav` properly gated so arbitrary tabs cannot inject false signals?
- [ ] Can timing attacks against `ns-nav-gesture` create false allow windows?
- [ ] Are rollback flows safe against races (two tabs triggering rollback simultaneously)?

### 5. Storage

**`chrome.storage.local` (persistent):**
| Key | Content | Sensitivity |
|-----|---------|-------------|
| `sentinelsuite:settings_v1` | Mode, thresholds, debug | Low |
| `sentinelsuite:trusted_domains_v1` | User-trusted registrable domains | Moderate |
| `sentinelsuite:event_log_v1` | Event kind, hostname, score (capped at 300) | Moderate |
| `sentinelsuite:prompt_outcomes_v1` | Domain pairs + outcomes | Moderate |
| `navsentinel:allowlist_v1` | Allowlisted site pairs | Moderate |
| `navsentinel:domain_profile_v1` | Per-domain stats | Low-moderate |

**`chrome.storage.session` (ephemeral, cleared on browser close):**
Tab-indexed maps for allow windows, gestures, rollback state, OAuth flow state. `allowTarget` stores a full URL (only full URL in session storage).

**Audit questions:**
- [ ] Can stored data be exfiltrated via a compromised content script?
- [ ] Are storage keys scoped correctly to prevent cross-feature interference?
- [ ] Is the event log bounded and does it avoid storing sensitive URL paths/query strings?

---

## Prioritized Review Areas

### Priority 1 — Critical (must review before CWS submission)

| Area | Files | Risk |
|------|-------|------|
| MAIN world API patches | `main_guard.ts` | Page can potentially bypass or manipulate patches |
| Bridge integrity | `main_guard.ts:693-778`, `capture_isolated.ts:497-507` | Session token is sole integrity gate |
| Shadow DOM UI security | `ui_toast.ts`, `credential_modal.ts` | `mode: "open"` allows page script access |
| Prototype hardening | `main_guard.ts` (`hardenProto` helper) | Patches must resist page-initiated override |

### Priority 2 — Important

| Area | Files | Risk |
|------|-------|------|
| SW message handling | `sw.ts` | Tab-gating correctness for cross-tab messages |
| Credential guard | `credential_guard.ts` | Form monitoring and domain trust decisions |
| OAuth flow detection | `capture_isolated.ts`, `dblclick_guard.ts` | Opener manipulation detection correctness |
| Storage data boundaries | `storage.ts` | No passwords/full-URLs stored, log bounds |

### Priority 3 — Nice to have

| Area | Files | Risk |
|------|-------|------|
| Scoring thresholds | `nrs.ts`, `scoring.ts` | False positive/negative rates |
| DNR rules | `rules/dnr_static.json` | Currently test stubs only |
| Build pipeline | `vite.config.ts`, `build-bloom-filter.mjs` | Supply chain, data integrity |
| Debug mode leaks | `main_guard.ts` debug globals | Info disclosure in debug mode |

---

## Known Issues to Address Before Audit

1. **`declarativeNetRequestWithHostAccess`** — Permission declared but unused. Remove before submission.
2. **Shadow DOM `mode: "open"`** — Security UI accessible to page scripts. Evaluate switching to `mode: "closed"` for toast and credential modal.
3. **Debug globals** — `__navsentinelLastNav` exposes internal state in debug mode. Ensure debug mode is off by default and document the risk.
4. **`window.postMessage("*")`** — Bridge init uses `targetOrigin: "*"`. Page scripts can observe the init message (though not intercept the port).

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
