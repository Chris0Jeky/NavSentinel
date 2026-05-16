# Bridge Security Review -- 2026-05-16

## Summary

This review covers the MAIN-world to ISOLATED-world bridge mechanism in NavSentinel, which uses a MessagePort channel with challenge-response authentication and per-document session nonces. The implementation is sound overall -- the challenge-response protocol correctly prevents external parties from hijacking an established bridge, and the session nonce prevents cross-document replay. No critical vulnerabilities were found. Several medium and low severity observations are documented below.

## Threat Model

The bridge connects two execution contexts within the same page:

| Actor | Capability |
|-------|-----------|
| Page script (attacker) | Can listen to `window.message` events, call `window.postMessage`, and read/write DOM. Cannot access `chrome.runtime`. |
| MAIN world guard (`main_guard.ts`) | Extension script injected into the page's MAIN world. Shares the JS heap with page scripts. |
| ISOLATED world (`capture_isolated.ts`) | Extension content script with access to `chrome.runtime` and privileged extension APIs. Isolated from page JS heap. |
| Service worker | Extension background context. Communicates via `chrome.runtime.sendMessage`. |

**Primary threats:**
1. A malicious page script impersonates the ISOLATED world to send commands to the MAIN guard.
2. A malicious page script replays captured bridge messages.
3. A malicious page script races the ISOLATED world during bridge initialization to steal the port.
4. A malicious page script floods with fake init messages to deny service.
5. Navigation causes stale port references or dangling handlers.

## Implementation Review

### `main_guard.ts` (MAIN world)

**Bridge initialization (lines 795-846):**
- Listens for `window.message` events with `source === window` (same-window origin check), matching `NS_SOURCE` and `BRIDGE_INIT_TYPE`.
- Validates `PROTOCOL_VERSION` and `session` string presence.
- Calls `event.stopImmediatePropagation()` and `event.stopPropagation()` to prevent page scripts from observing the init message.
- Accepts `event.ports[0]` as the new MessagePort.
- Closes any prior port before accepting the new one -- correctly handles reconnection.
- Sets `bridgeVerified = false` and generates a fresh 128-bit challenge.
- Sends `ns-challenge` to the port and waits for `ns-challenge-response` with matching challenge.
- Only after verification sets `bridgeVerified = true`, replaces the `onmessage` handler, and flushes pending outbound.

**Session validation (lines 669-731):**
- `handleBridgeMessage` rejects any message where `data.session !== bridgeSession`.
- Only processes message types from a known allowlist: `ns-gesture-allow`, `ns-config`, `ns-ping`, `ns-allow-once`, `ns-allow`, `ns-allow-action`.

**Key observations:**
- The challenge is 128 bits (16 random bytes, hex-encoded) -- sufficient entropy.
- `bridgeSession` is locked to the first valid init message's session value. Subsequent inits with a different session are rejected (`if (bridgeSession && data.session !== bridgeSession) return;`). However, the first init with the *same* session is accepted and triggers re-verification, which is correct behavior for retry handling.
- The MAIN world event listener is registered with `true` (capture phase), maximizing the chance it fires before page listeners.

### `capture_isolated.ts` (ISOLATED world)

**Bridge session (lines 100-103, 119-122):**
- `bridgeSession` is generated once per document via `makeBridgeSession()` using 128-bit `crypto.getRandomValues`.
- This session is constant for the document's lifetime -- it is the authentication token proving bridge ownership.

**`ensureBridge()` (lines 508-565):**
- Guards against re-entry: returns immediately if `bridgeReady`, `mainGuard === "no"`, or a retry timer is already running.
- Records `bridgeInitStartedAt` for overall timeout enforcement (10 seconds max).
- On each attempt: increments `bridgeAttemptGen`, closes previous port, creates a fresh `MessageChannel`, and posts `port2` to the window.
- Retry uses exponential backoff: 100ms, 200ms, 400ms, 800ms, capped at 1000ms.
- Stale-generation detection: if `bridgeAttemptGen !== thisGen` when the retry timer fires, it aborts -- correctly prevents stale retries from conflicting with newer attempts.

**Challenge-response handling (lines 376-385):**
- Upon receiving `ns-challenge` on the port, responds with `ns-challenge-response` echoing the challenge value, session, and source.
- Only responds if `data.session === bridgeSession` -- preventing challenge answers to forged sessions.

**Key observations:**
- The isolated world creates the `MessageChannel` and retains `port1`, sending `port2` through `window.postMessage`. Only code listening on the window message event in the capture phase can grab `port2`.
- After the MAIN guard receives `port2` and sends a challenge *back through the port*, only the holder of `port1` (the isolated world) can answer. A page script cannot intercept MessagePort traffic.

## Findings

### Finding 1: Race window during init postMessage (Severity: Low)

**Description:** The `window.postMessage` call in `ensureBridge()` uses target origin `"*"`. Any script listening on `window.message` in the capture phase (registered before the extension's content script) can observe the init message, though it cannot steal the transferred port (transfer is exclusive).

**Impact:** An attacker could observe that NavSentinel is present and learn the `bridgeSession` value from the init message payload. However, knowing the session alone is insufficient to compromise the bridge because:
1. The attacker cannot obtain either end of the transferred MessagePort (transfer removes it from the event).
2. The subsequent challenge-response occurs over the MessagePort, not the window message channel.

**Recommendation:** This is acceptable given Chrome's content script injection timing guarantees (extension scripts in `document_start` run before page scripts). The session value in the init message is an information leak but not exploitable. If defense-in-depth is desired, the session could be omitted from the init message and only sent over the port after transfer.

### Finding 2: No explicit bridge teardown on navigation (Severity: Low)

**Description:** Neither file explicitly closes or nullifies the bridge port on `beforeunload`, `pagehide`, or `visibilitychange` (hidden -> frozen). The port relies on garbage collection when the document is destroyed.

**Impact:** In practice, Chrome's MessagePort implementation closes ports when either end's realm is destroyed. However, during bfcache restoration, a stale port could theoretically remain without proper re-initialization.

**Recommendation:** Consider adding a `pagehide` listener that calls `bridgePort?.close()` and sets `bridgeReady = false` on the isolated side, with `ensureBridge()` called on `pageshow` to handle bfcache restores. Current risk is minimal because NavSentinel's content scripts are re-injected on navigation in MV3.

### Finding 3: Session nonce not cryptographically bound to challenge (Severity: Info)

**Description:** The challenge-response protocol sends `{ session, challenge }` and expects `{ session, challenge }` back. The challenge value is independent of the session. This is technically a two-factor check (must hold the port AND know the challenge), but the session is already known from the init message.

**Impact:** None in practice. The true authentication factor is port possession (only the port holder receives the challenge). The session serves as a document-scoping mechanism to reject cross-document messages, not as a secret.

**Recommendation:** No action needed. The design is correct. The session prevents a stale MAIN guard from processing messages meant for a new document context.

### Finding 4: Replay of challenge-response is not possible (Severity: Info -- Positive finding)

**Description:** Each bridge initialization generates a fresh 128-bit random challenge (`generateChallenge()`). The challenge is set to `null` after successful verification and never reused. Even if an attacker could somehow observe port traffic (they cannot), a replayed response would not match a future challenge.

**Impact:** Replay attacks are not viable.

### Finding 5: Pending outbound queue is unbounded by content (Severity: Low)

**Description:** `pendingOutbound` in `main_guard.ts` is capped at 32 entries (MAX_PENDING_OUTBOUND), and `pendingBridgeMessages` in `capture_isolated.ts` is also capped at 32. However, the messages themselves have no size limit. A rapid succession of `postToIsolated` calls with large payloads before bridge verification could consume memory.

**Impact:** Minimal. The payloads are internally constructed (URLs, timestamps, short strings) and not attacker-controlled in size. The 32-entry cap with FIFO eviction is sufficient.

**Recommendation:** No action needed.

### Finding 6: stopImmediatePropagation relies on listener registration order (Severity: Medium)

**Description:** The MAIN guard calls `event.stopImmediatePropagation()` on the bridge init message to prevent page scripts from observing it. This only works if the extension's listener was registered before the page's listeners on the same event target in the same phase (capture). Chrome guarantees `document_start` content scripts run before page scripts, so the MAIN world script (injected at `document_start`) registers its listener first.

**Impact:** If a page somehow manages to register a capture-phase `message` listener before the extension's MAIN world script runs (e.g., via a service worker cache or preload manipulation), it could observe the init message. However, as noted in Finding 1, the session is the only leaked value and the port is exclusively transferred.

**Recommendation:** The current approach is the best available in the Chrome extension model. The `document_start` injection timing is the strongest guarantee Chrome provides. No change needed, but this assumption should be documented.

### Finding 7: bridgeSession reuse across retries enables race-and-replace (Severity: Medium)

**Description:** The MAIN guard logic at line 807 is: `if (bridgeSession && data.session !== bridgeSession) return;`. This means once a session is established, only messages with that same session are accepted. On the first init (when `bridgeSession` is null), any session value is accepted. Subsequent retries from the isolated world reuse the same `bridgeSession`, which is correct behavior.

However, there is a narrow window: if an attacker posts a fake init message with a different session value AND a transferred port *before* the extension's first init message arrives (between `document_start` and the first `ensureBridge()` call), the MAIN guard would accept the attacker's session. The subsequent challenge-response would then occur over the attacker's port, and the attacker could answer the challenge.

**Mitigating factors:**
1. Chrome's `document_start` timing means the extension's message listener is registered first and the extension's init fires before any page script runs.
2. The attacker would need to transfer a real MessagePort and answer the challenge within the same turn.
3. Even if successful, the attacker gains the ability to send commands to the MAIN guard (allow-once, gesture-allow), which would *reduce* security (allowing blocked navigations). The attacker cannot use this to *block* legitimate user actions or steal data.

**Recommendation:** Consider having the MAIN guard validate that the init message's `event.origin` or source matches expected values, or require a pre-shared token injected at script build time. However, given the mitigating factors, this is a theoretical concern with no practical exploit path in standard Chrome environments.

## Overall Assessment

The bridge implementation is **well-designed and secure for its threat model**. The key security properties hold:

1. **Port exclusivity**: MessagePort transfer is atomic -- only one party gets the port.
2. **Challenge freshness**: 128-bit random per connection attempt, nullified after use.
3. **Session scoping**: Per-document nonce prevents cross-document message injection.
4. **Listener priority**: `document_start` + capture phase ensures the extension processes init messages before page scripts.
5. **Race condition fixes**: The fb72412 commit's exponential backoff, generation tracking, and timeout correctly address the race windows from issues #86 and #90.

No critical or high severity vulnerabilities were found. The medium findings are theoretical in standard Chrome environments and would require non-standard execution timing to exploit.

## Recommendations (Priority Order)

1. **(Low effort)** Document the `document_start` timing assumption explicitly in SECURITY.md.
2. **(Low effort)** Add `pagehide`/`pageshow` handlers for bfcache lifecycle cleanup.
3. **(Medium effort)** Remove the `session` field from the `window.postMessage` init payload -- pass it only through the port after transfer. This eliminates the information leak in Finding 1 without changing the protocol semantics.
4. **(Low effort)** Add a comment documenting that Finding 7's theoretical attack requires violating Chrome's content script injection ordering, which is not possible in standard Chromium.
