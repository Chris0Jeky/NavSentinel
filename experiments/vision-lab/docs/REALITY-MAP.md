# What is real, what is simulated, what is not installed

This is an isolated vision laboratory, not a NavSentinel release, an audit, or a substitute for the upstream guard. “Complete” refers to navigable prototype workflows, not comprehensive threat protection.

| Capability | What actually runs | Evidence ceiling |
|---|---|---|
| Three product interfaces | Dependency-free interactive HTML/JS; responsive layouts, keyboard palette, dialogs, journal, settings, filters | Chromium-rendered interface tests |
| Shared decision kernel | Typed validation, group caps, hard invariants, separate exact-host trust, Smart/Strict/Observe | 20 invented contracts; no calibrated probabilities or real-world detection estimate |
| Studio page interception | Scripted scenario replay, with fixture containment and Undo | Simulation, not a real web-page guard |
| Unpacked MV3 guard | Opt-in origin registration, captured click/submit checks, bounded transparent-layer cleanup, authoritative popup actions | Source implementation; **real extension runtime unvalidated here** because managed browser policy blocks extensions and URLs |
| Credentials | Input-type and action-destination inspection; no field values read | Captured submit path only; not keystroke/fetch/form.submit coverage |
| Desktop workspace | Investigation, data-flow graph, corrections, coverage inventory, recovery checklist | Functional web UI; incident stories and shell correlation are fixtures |
| Electron shell | Pinned optional dependency; owned loopback service; narrow IPC; sandbox/context isolation | Source/syntax checked, **not installed or launched** here |
| Intent Relay | Authenticated Node HTTP service on 127.0.0.1; strict Host/Origin checks; fixed client contract; operator approvals | Live API tests on loopback |
| Capability execution | Exact normalized event binding, 30-second TTL, one-time consumption, mismatch burns, revocation | Real enforcement **inside the cooperative broker**; executor records an inert receipt only |
| Agent containment | No OS/process/network sandbox | A non-cooperating process can bypass the broker entirely |
| Ledger | Bounded, atomically replaced, hash-chained local JSON; verifies on reopen | Local consistency, **not a signature**, not authenticity against a same-user OS attacker |
| Persistence | Studio localStorage; extension chrome.storage; daemon local file | Daemon persistence tested; UI storage exercised with an explicitly disclosed opaque-origin shim, not native file-origin persistence |
| Live API UI | Renderer request/approve/consume flows against actual Node server through a test transport | API integration tested; not a native Electron IPC or Chromium networking test |
| Export | User-triggered allowlist serializer; local JSON/Markdown files | Explicit sharing only; origins remain sensitive metadata |
| Clipboard, DNS, kernel filters, process suspension, malware scans | Not implemented | No claim of detection or prevention |
| Models, reputation, native messaging, community rule updates, family/mobile service | Not installed or connected | Horizon architecture options, not deployed features |

## Boundaries worth keeping

A numeric score is a heuristic ranking, never a probability. A fixture match is not a prevented attack. An extension log is not an independent sink receipt. A hash-consistent ledger is not a signed attestation. A recovery checkbox is a reviewed rehearsal step, not proof that recovery took place.

The three offline HTML files share a codebase, but their native storage isolation depends on how the browser treats file origins. The loopback studio gives all three views one stable origin. Extension storage and daemon storage remain deliberately separate. No automatic browser-to-desktop telemetry or evidence synchronization is implemented.
