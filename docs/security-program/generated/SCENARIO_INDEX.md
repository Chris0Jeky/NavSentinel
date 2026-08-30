# Scenario index

Generated from `registry/scenarios.json`. Do not edit this view by hand.

Registry: 168 scenarios across 21 families. Scenario evidence states remain conservative until the required receipts support promotion.

| ID | Family | Priority | Severity | Evidence | Title |
| --- | --- | --- | --- | --- | --- |
| NS-ADV-NAV-001 | NAV | P0 | S3 | UNMODELLED | Delayed cross-site `location.assign` after intent expiry |
| NS-ADV-NAV-002 | NAV | P1 | S3 | UNMODELLED | Same-registrable-domain tenant hop |
| NS-ADV-NAV-003 | NAV | P1 | S3 | UNMODELLED | Meta-refresh trust laundering |
| NS-ADV-NAV-004 | NAV | P0 | S3 | UNMODELLED | Open-redirect multi-hop chain |
| NS-ADV-NAV-005 | NAV | P0 | S3 | UNMODELLED | Form destination swapped after pointer-down |
| NS-ADV-NAV-006 | NAV | P1 | S3 | UNMODELLED | SPA history facade followed by external commit |
| NS-ADV-NAV-007 | NAV | P1 | S3 | UNMODELLED | Back-button bounce and history trap |
| NS-ADV-NAV-008 | NAV | P1 | S3 | UNMODELLED | Secret-bearing URL decoration across redirects |
| NS-ADV-WIN-001 | WIN | P0 | S3 | UNMODELLED | Popunder created from a trusted click |
| NS-ADV-WIN-002 | WIN | P0 | S3 | UNMODELLED | Popup burst after legitimate OAuth |
| NS-ADV-WIN-003 | WIN | P0 | S3 | UNMODELLED | Named-window reuse laundering |
| NS-ADV-WIN-004 | WIN | P0 | S3 | UNMODELLED | Child rewrites opener then closes |
| NS-ADV-WIN-005 | WIN | P0 | S3 | UNMODELLED | Allow-once capability double spend |
| NS-ADV-WIN-006 | WIN | P2 | S3 | UNMODELLED | Tiny or off-screen popup |
| NS-ADV-WIN-007 | WIN | P1 | S3 | UNMODELLED | Inherited about:blank/blob child pivots cross-origin |
| NS-ADV-WIN-008 | WIN | P0 | S3 | UNMODELLED | Cross-tab prompt and state confusion |
| NS-ADV-UI-001 | UI | P0 | S3 | UNMODELLED | Transparent full-viewport click shield |
| NS-ADV-UI-002 | UI | P0 | S3 | UNMODELLED | Moving target under cursor |
| NS-ADV-UI-003 | UI | P0 | S3 | UNMODELLED | Overlay injected after pointer-down |
| NS-ADV-UI-004 | UI | P0 | S3 | UNMODELLED | Sequential overlay reinsertion |
| NS-ADV-UI-005 | UI | P1 | S3 | UNMODELLED | Focus and pointer retargeting |
| NS-ADV-UI-006 | UI | P1 | S3 | UNMODELLED | Browser-in-the-browser fake chrome |
| NS-ADV-UI-007 | UI | P0 | S3 | UNMODELLED | Fake extension or password-manager prompt |
| NS-ADV-UI-008 | UI | P1 | S3 | UNMODELLED | Canvas, shadow, and nested-frame deceptive surface |
| NS-ADV-CRED-001 | CRED | P0 | S4 | UNMODELLED | Cross-origin password form action |
| NS-ADV-CRED-002 | CRED | P0 | S4 | UNMODELLED | Same-origin form with third-party scripted exfiltration |
| NS-ADV-CRED-003 | CRED | P0 | S4 | UNMODELLED | Late form-action mutation |
| NS-ADV-CRED-004 | CRED | P1 | S4 | UNMODELLED | Hidden or autofilled credential field |
| NS-ADV-CRED-005 | CRED | P0 | S4 | UNMODELLED | Shadow-DOM credential form |
| NS-ADV-CRED-006 | CRED | P0 | S4 | UNMODELLED | Fake reauthentication on a trusted page |
| NS-ADV-CRED-007 | CRED | P0 | S4 | UNMODELLED | OTP, recovery-code, or seed-phrase harvesting |
| NS-ADV-CRED-008 | CRED | P0 | S4 | UNMODELLED | Password-manager master-password imitation |
| NS-ADV-IDN-001 | IDN | P0 | S3 | UNMODELLED | Unicode homograph of an established domain |
| NS-ADV-IDN-002 | IDN | P1 | S3 | UNMODELLED | Punycode and display-mode ambiguity |
| NS-ADV-IDN-003 | IDN | P1 | S3 | UNMODELLED | Separator-only brand spoof |
| NS-ADV-IDN-004 | IDN | P0 | S3 | UNMODELLED | Deep subdomain and path brand stuffing |
| NS-ADV-IDN-005 | IDN | P1 | S3 | UNMODELLED | Shared cloud-host tenant ambiguity |
| NS-ADV-IDN-006 | IDN | P1 | S3 | UNMODELLED | IP literal, odd port, or scheme downgrade |
| NS-ADV-IDN-007 | IDN | P0 | S3 | UNMODELLED | Compromised sibling subdomain |
| NS-ADV-IDN-008 | IDN | P1 | S3 | UNMODELLED | Shortener or QR destination concealment |
| NS-ADV-AUTH-001 | AUTH | P0 | S4 | UNMODELLED | OAuth redirect URI mismatch or open-redirect pivot |
| NS-ADV-AUTH-002 | AUTH | P0 | S4 | UNMODELLED | Generic `code` parameter outside an auth flow |
| NS-ADV-AUTH-003 | AUTH | P0 | S4 | UNMODELLED | Provider mix-up and concurrent-flow confusion |
| NS-ADV-AUTH-004 | AUTH | P1 | S4 | UNMODELLED | Form-post authorization response |
| NS-ADV-AUTH-005 | AUTH | P0 | S4 | UNMODELLED | Legitimate auth popup followed by malicious second popup |
| NS-ADV-AUTH-006 | AUTH | P1 | S4 | UNMODELLED | Consent phishing with excessive scopes |
| NS-ADV-AUTH-007 | AUTH | P1 | S4 | UNMODELLED | Device-code phishing |
| NS-ADV-AUTH-008 | AUTH | P1 | S4 | UNMODELLED | QR login relay or passkey-fallback phishing |
| NS-ADV-CLIP-001 | CLIP | P0 | S4 | UNMODELLED | Fake CAPTCHA copies a shell command |
| NS-ADV-CLIP-002 | CLIP | P0 | S4 | UNMODELLED | Clipboard-event flood starves a navigation alert |
| NS-ADV-CLIP-003 | CLIP | P1 | S4 | UNMODELLED | Developer-doc command versus dangerous command |
| NS-ADV-CLIP-004 | CLIP | P0 | S4 | UNMODELLED | Cryptocurrency or bank-account replacement |
| NS-ADV-CLIP-005 | CLIP | P1 | S4 | UNMODELLED | Delayed clipboard rewrite after manual copy |
| NS-ADV-CLIP-006 | CLIP | P2 | S4 | UNMODELLED | HTML or image clipboard deception |
| NS-ADV-CLIP-007 | CLIP | P1 | S4 | UNMODELLED | Remote-support code and control handoff |
| NS-ADV-CLIP-008 | CLIP | P1 | S4 | UNMODELLED | Paste into shell outside the browser |
| NS-ADV-FILE-001 | FILE | P0 | S4 | UNMODELLED | Fake browser update or codec download |
| NS-ADV-FILE-002 | FILE | P1 | S4 | UNMODELLED | Drive-by blob or data-URL download |
| NS-ADV-FILE-003 | FILE | P1 | S4 | UNMODELLED | Filename, extension, icon, and MIME mismatch |
| NS-ADV-FILE-004 | FILE | P2 | S4 | UNMODELLED | Password-protected archive lure |
| NS-ADV-FILE-005 | FILE | P1 | S4 | UNMODELLED | Extension sideload or developer-mode lure |
| NS-ADV-FILE-006 | FILE | P2 | S4 | UNMODELLED | File System Access mass modification |
| NS-ADV-FILE-007 | FILE | P1 | S4 | UNMODELLED | Repeated download bomb and nuisance loop |
| NS-ADV-FILE-008 | FILE | P1 | S4 | UNMODELLED | Legitimate signed installer reached through compromised advertising |
| NS-ADV-FLOW-001 | FLOW | P0 | S4 | UNMODELLED | Synthetic credential sent by fetch/XHR |
| NS-ADV-FLOW-002 | FLOW | P1 | S4 | UNMODELLED | Unload or visibility-change beacon exfiltration |
| NS-ADV-FLOW-003 | FLOW | P2 | S4 | UNMODELLED | WebSocket or streaming exfiltration |
| NS-ADV-FLOW-004 | FLOW | P2 | S4 | UNMODELLED | Image, font, or query-string covert channel |
| NS-ADV-FLOW-005 | FLOW | P1 | S4 | UNMODELLED | Cross-frame postMessage handoff |
| NS-ADV-FLOW-006 | FLOW | P1 | S4 | UNMODELLED | Referrer or URL token leakage |
| NS-ADV-FLOW-007 | FLOW | P2 | S4 | UNMODELLED | Service-worker background sync or cached replay |
| NS-ADV-FLOW-008 | FLOW | P3 | S4 | UNMODELLED | CSS or side-channel-style exfiltration envelope |
| NS-ADV-PRIV-001 | PRIV | P1 | S3 | UNMODELLED | Canvas fingerprinting sequence |
| NS-ADV-PRIV-002 | PRIV | P1 | S3 | UNMODELLED | WebGL and audio composite fingerprint |
| NS-ADV-PRIV-003 | PRIV | P1 | S3 | UNMODELLED | Font, screen, hardware, and locale composite |
| NS-ADV-PRIV-004 | PRIV | P1 | S3 | UNMODELLED | WebRTC and local-network probing |
| NS-ADV-PRIV-005 | PRIV | P2 | S3 | UNMODELLED | Behavioral typing, mouse, and interaction biometrics |
| NS-ADV-PRIV-006 | PRIV | P1 | S3 | UNMODELLED | Storage resurrection, cookie syncing, and CNAME cloaking |
| NS-ADV-PRIV-007 | PRIV | P1 | S3 | UNMODELLED | Tracking before consent |
| NS-ADV-PRIV-008 | PRIV | P1 | S3 | UNMODELLED | Authentication fingerprinting: security versus tracking |
| NS-ADV-PERM-001 | PERM | P1 | S3 | UNMODELLED | Notification permission fatigue |
| NS-ADV-PERM-002 | PERM | P1 | S3 | UNMODELLED | Geolocation pretext |
| NS-ADV-PERM-003 | PERM | P1 | S3 | UNMODELLED | Camera or microphone verification lure |
| NS-ADV-PERM-004 | PERM | P0 | S3 | UNMODELLED | Fullscreen, audio, and pointer-lock scareware |
| NS-ADV-PERM-005 | PERM | P1 | S3 | UNMODELLED | Clipboard-read permission pretext |
| NS-ADV-PERM-006 | PERM | P1 | S3 | UNMODELLED | File-picker or directory permission pretext |
| NS-ADV-PERM-007 | PERM | P1 | S3 | UNMODELLED | Chained permission escalation |
| NS-ADV-PERM-008 | PERM | P0 | S3 | UNMODELLED | Legitimate conference, map, upload, and game journeys |
| NS-ADV-RUNTIME-001 | RUNTIME | P0 | S3 | UNMODELLED | Closed-shadow-root attack surface |
| NS-ADV-RUNTIME-002 | RUNTIME | P1 | S3 | UNMODELLED | Canvas or WebGL textless lure |
| NS-ADV-RUNTIME-003 | RUNTIME | P1 | S3 | UNMODELLED | Pseudo-elements and adopted-style deception |
| NS-ADV-RUNTIME-004 | RUNTIME | P1 | S3 | UNMODELLED | Obfuscated delayed dynamic import |
| NS-ADV-RUNTIME-005 | RUNTIME | P2 | S3 | UNMODELLED | WebAssembly-mediated behavior |
| NS-ADV-RUNTIME-006 | RUNTIME | P0 | S3 | UNMODELLED | Page patches APIs before extension initialization |
| NS-ADV-RUNTIME-007 | RUNTIME | P0 | S3 | UNMODELLED | Mutation and event flood |
| NS-ADV-RUNTIME-008 | RUNTIME | P1 | S3 | UNMODELLED | Extension detection and adaptive behavior |
| NS-ADV-STATE-001 | STATE | P0 | S4 | UNMODELLED | Service-worker restart between action and decision |
| NS-ADV-STATE-002 | STATE | P0 | S4 | UNMODELLED | Bridge loss or absent heartbeat |
| NS-ADV-STATE-003 | STATE | P0 | S4 | UNMODELLED | Pre-bridge queue overflow and priority inversion |
| NS-ADV-STATE-004 | STATE | P0 | S4 | UNMODELLED | BFCache restore with stale allowances |
| NS-ADV-STATE-005 | STATE | P1 | S4 | UNMODELLED | Tab discard and restore |
| NS-ADV-STATE-006 | STATE | P1 | S4 | UNMODELLED | Extension update during an active flow |
| NS-ADV-STATE-007 | STATE | P0 | S4 | UNMODELLED | Removed frame or document receives stale approval |
| NS-ADV-STATE-008 | STATE | P0 | S4 | UNMODELLED | Rapid close/reopen and state leakage |
| NS-ADV-FRAME-001 | FRAME | P0 | S4 | UNMODELLED | Nested cross-origin credential iframe |
| NS-ADV-FRAME-002 | FRAME | P1 | S4 | UNMODELLED | Injected srcdoc, data, or blob frame |
| NS-ADV-FRAME-003 | FRAME | P1 | S4 | UNMODELLED | Sandboxed top-navigation by user activation |
| NS-ADV-FRAME-004 | FRAME | P0 | S4 | UNMODELLED | Cross-frame clickjacking |
| NS-ADV-FRAME-005 | FRAME | P0 | S4 | UNMODELLED | Removed or replaced child frame with pending action |
| NS-ADV-FRAME-006 | FRAME | P2 | S4 | UNMODELLED | Opaque-origin or fenced-context visibility gap |
| NS-ADV-FRAME-007 | FRAME | P0 | S4 | UNMODELLED | Legitimate 3DS or embedded payment control |
| NS-ADV-FRAME-008 | FRAME | P0 | S4 | UNMODELLED | Legitimate enterprise SSO embed |
| NS-ADV-MONEY-001 | MONEY | P0 | S4 | UNMODELLED | Invoice-approval redirect trap |
| NS-ADV-MONEY-002 | MONEY | P0 | S4 | UNMODELLED | Express-pay overlay hijack |
| NS-ADV-MONEY-003 | MONEY | P0 | S4 | UNMODELLED | Wallet-connect first approval then drain |
| NS-ADV-MONEY-004 | MONEY | P0 | S4 | UNMODELLED | Payee, account, or wallet-address swap |
| NS-ADV-MONEY-005 | MONEY | P1 | S4 | UNMODELLED | Amount or asset mutation after review |
| NS-ADV-MONEY-006 | MONEY | P0 | S4 | UNMODELLED | Seed phrase or recovery-key request |
| NS-ADV-MONEY-007 | MONEY | P0 | S4 | UNMODELLED | Bank security-alert verification |
| NS-ADV-MONEY-008 | MONEY | P1 | S4 | UNMODELLED | QR payment or invoice substitution |
| NS-ADV-SOCIAL-001 | SOCIAL | P0 | S4 | UNMODELLED | Full-screen tech-support scareware |
| NS-ADV-SOCIAL-002 | SOCIAL | P1 | S4 | UNMODELLED | Fake virus scan and escalating result |
| NS-ADV-SOCIAL-003 | SOCIAL | P0 | S4 | UNMODELLED | Account suspended reauthentication |
| NS-ADV-SOCIAL-004 | SOCIAL | P1 | S4 | UNMODELLED | Parcel, customs, or small-fee lure |
| NS-ADV-SOCIAL-005 | SOCIAL | P1 | S4 | UNMODELLED | Job recruitment document or installer lure |
| NS-ADV-SOCIAL-006 | SOCIAL | P1 | S4 | UNMODELLED | Investment or crypto urgency |
| NS-ADV-SOCIAL-007 | SOCIAL | P1 | S4 | UNMODELLED | Countdown and repeated interruption coercion |
| NS-ADV-SOCIAL-008 | SOCIAL | P0 | S4 | UNMODELLED | Fake human verification and remote-support handoff |
| NS-ADV-SUPPLY-001 | SUPPLY | P0 | S4 | UNMODELLED | Malvertising overlay on a reputable publisher |
| NS-ADV-SUPPLY-002 | SUPPLY | P0 | S4 | UNMODELLED | Compromised third-party CDN script on a trusted origin |
| NS-ADV-SUPPLY-003 | SUPPLY | P1 | S4 | UNMODELLED | Tag-manager or analytics container abuse |
| NS-ADV-SUPPLY-004 | SUPPLY | P0 | S4 | UNMODELLED | Stored or reflected script compromise on a familiar site |
| NS-ADV-SUPPLY-005 | SUPPLY | P1 | S4 | UNMODELLED | Abandoned tenant or subdomain takeover |
| NS-ADV-SUPPLY-006 | SUPPLY | P1 | S4 | UNMODELLED | Compromised support, chat, or consent widget |
| NS-ADV-SUPPLY-007 | SUPPLY | P1 | S4 | UNMODELLED | Malicious service-worker or cache persistence after site cleanup |
| NS-ADV-SUPPLY-008 | SUPPLY | P2 | S4 | UNMODELLED | Conflicting or malicious co-installed extension |
| NS-ADV-EVADE-001 | EVADE | P0 | S3 | UNMODELLED | Crawler and headless-browser cloaking |
| NS-ADV-EVADE-002 | EVADE | P1 | S3 | UNMODELLED | Geolocation, language, referrer, or campaign gating |
| NS-ADV-EVADE-003 | EVADE | P0 | S3 | UNMODELLED | Time bomb, idle trigger, and calendar gating |
| NS-ADV-EVADE-004 | EVADE | P0 | S3 | UNMODELLED | Deep-interaction and scroll-depth trigger |
| NS-ADV-EVADE-005 | EVADE | P1 | S3 | UNMODELLED | One-time, first-visit, or token-burn attack |
| NS-ADV-EVADE-006 | EVADE | P0 | S3 | UNMODELLED | Randomized DOM, text, and localization variants |
| NS-ADV-EVADE-007 | EVADE | P1 | S3 | UNMODELLED | Debugger, DevTools, or instrumentation detection |
| NS-ADV-EVADE-008 | EVADE | P0 | S3 | UNMODELLED | NavSentinel fingerprinting and selective bypass |
| NS-ADV-SELF-001 | SELF | P0 | S4 | UNMODELLED | Page imitates NavSentinel warning or trusted UI |
| NS-ADV-SELF-002 | SELF | P0 | S4 | UNMODELLED | Page covers, relocates, removes, or races injected warning UI |
| NS-ADV-SELF-003 | SELF | P0 | S4 | UNMODELLED | Trusted-click redressing of a protection-lowering action |
| NS-ADV-SELF-004 | SELF | P0 | S4 | UNMODELLED | Bridge message forgery, replay, or peer takeover |
| NS-ADV-SELF-005 | SELF | P0 | S4 | UNMODELLED | Critical-event flood and queue starvation |
| NS-ADV-SELF-006 | SELF | P0 | S4 | UNMODELLED | Storage, import, or configuration poisoning |
| NS-ADV-SELF-007 | SELF | P1 | S4 | UNMODELLED | Reason-code, diagnostic, or event-attribution spoofing |
| NS-ADV-SELF-008 | SELF | P0 | S4 | UNMODELLED | Degraded-mode concealment and stale unpacked loader |
| NS-ADV-NATIVE-001 | NATIVE | P0 | S4 | UNMODELLED | Browser-tainted clipboard pasted into a shell-class target |
| NS-ADV-NATIVE-002 | NATIVE | P1 | S4 | UNMODELLED | Downloaded artifact reaches the execution boundary |
| NS-ADV-NATIVE-003 | NATIVE | P0 | S4 | UNMODELLED | Foreground-process or paste-destination misclassification |
| NS-ADV-NATIVE-004 | NATIVE | P0 | S4 | UNMODELLED | Native-messaging host spoof, protocol downgrade, or confused deputy |
| NS-ADV-NATIVE-005 | NATIVE | P0 | S4 | UNMODELLED | Companion installer or updater supply-chain compromise |
| NS-ADV-NATIVE-006 | NATIVE | P1 | S4 | UNMODELLED | Local model tamper or prompt-injection influence |
| NS-ADV-NATIVE-007 | NATIVE | P2 | S4 | UNMODELLED | DNS, captive-portal, proxy, or certificate-context anomaly |
| NS-ADV-NATIVE-008 | NATIVE | P1 | S4 | UNMODELLED | OS clipboard replacement by another local process |
| NS-ADV-AGENT-001 | AGENT | P0 | S4 | UNMODELLED | Invisible prompt injection aimed at a browser agent |
| NS-ADV-AGENT-002 | AGENT | P0 | S4 | UNMODELLED | Agent clicks a deceptive or retargeted surface |
| NS-ADV-AGENT-003 | AGENT | P0 | S4 | UNMODELLED | Agent submits credentials across an origin or task boundary |
| NS-ADV-AGENT-004 | AGENT | P0 | S4 | UNMODELLED | Agent downloads or executes an artifact |
| NS-ADV-AGENT-005 | AGENT | P0 | S4 | UNMODELLED | Agent grants browser or site permissions |
| NS-ADV-AGENT-006 | AGENT | P0 | S4 | UNMODELLED | Agent approves OAuth consent, payment, or wallet action |
| NS-ADV-AGENT-007 | AGENT | P1 | S4 | UNMODELLED | Fake success state or completion proof |
| NS-ADV-AGENT-008 | AGENT | P0 | S4 | UNMODELLED | Multi-tab, multi-agent, or resumed-task state confusion |
