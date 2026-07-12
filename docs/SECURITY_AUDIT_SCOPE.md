# NavSentinel External Security Review Scope

> **Preparation only — no external review has occurred.** P3-09 and RI-08 are
> open. Do not describe NavSentinel as externally audited or use this document
> as release approval.

## Review objective

Determine whether the exact proposed release can safely mediate consequential
browser interactions while a fully hostile page controls its DOM, styles,
scripts, timing, frames, and navigation attempts. The review must cover both
bypass of protection and attacker-induced false intervention or data exposure.

The review target is one immutable commit and its packaged extension artifact,
not a moving branch. Record the browser/version, manifest, release profile,
build inputs, package hash, and enabled capability flags in the final report.

## Entry criteria

External review starts only after:

- RI-01 through RI-07 in `Project_Roadmap.md` are complete;
- page-injected UI is warn/cancel only, while proceed, allow, trust, and resume
  require extension-origin UI and a tab/destination-bound, short-lived pending
  decision;
- the dead visual-sim path and fake DNR surface are removed;
- the beta release profile, permissions, Web Accessible Resources, storage
  inventory, privacy disclosure, and package checks agree;
- broad JS behavior instrumentation is demonstrably off in the beta profile;
- current unit, build, package, and browser regression lanes pass; and
- known limitations and accepted residual risks have named owners.

If any entry criterion is false, return the package for remediation rather than
reviewing a knowingly obsolete architecture.

## Trust boundaries and required review areas

### 1. Page-controlled UI and extension-origin decisions

Review `ui_toast.ts`, `credential_modal.ts`, popup/options decision UI, pending
action state, and every proceed/allow/trust/resume call site.

Attempt synthetic activation, trusted-click redressing, host movement/removal,
CSS occlusion, focus capture, keyboard activation, frame confusion, tab switch,
destination mutation, replay, and expiry races. Closing a shadow root or checking
`event.isTrusted` is defense in depth, not sufficient authorization.

Required property: a hostile page cannot cause any protection-lowering action;
the extension-origin decision is visibly bound to the intended tab, action, and
destination, expires quickly, and is consumed once.

### 2. MAIN-world interception and compatibility

Review all patches to `window.open`, location, forms, history, clipboard,
`execCommand`, fetch/XHR/beacon, and opener behavior in `main_guard.ts` and
related modules.

Test early-reference capture, descriptor/prototype mutation, redefinition,
multi-frame ordering, navigation races, exception behavior, double wrapping,
framework wrappers, and service-worker/content-script restart. Confirm the beta
capability profile never installs frozen or unmeasured wrappers.

### 3. MAIN-world to isolated-world bridge

Review bridge initialization, MessagePort ownership, challenge/response,
schemas, size/rate bounds, queueing, timeout/recovery, and every allow/replay
message. Treat the challenge as a liveness/port-possession check, not proof of
an isolated-world identity.

Attempt init interception, competing ports, token replay, malformed messages,
queue exhaustion, navigation during handshake, isolated-script reinjection,
and cross-frame confusion. Resolve #175/#186 before public launch.

### 4. Content script to service worker and navigation state

Review all `runtime.sendMessage` handlers, sender/tab/frame validation, session
hydration, allow windows, target authorization, gesture state, OAuth state,
rollback/forward state, redirect chains, icon updates, and tab teardown.

Attempt stale-tab reuse, tab-id churn, wrong-frame messages, destination
canonicalization changes, concurrent rollbacks, worker suspension at every
await, and same-window/background-tab confusion. Exact operational URLs may be
retained only where correctness requires them, with tab binding and TTL.

### 5. Credential and clipboard handling

Review form-action resolution, submit/resume paths, password-field discovery,
TOCTOU defenses, trust decisions, paste detection, and clipboard interception.

Confirm password and clipboard values are never logged, stored, exported,
messaged beyond the narrow transient operation, or exposed in error/debug paths.
Test `formaction`, disabled/hidden decoys, shadow DOM, dynamic fields, nested
frames, DOM mutation between decision and submit, and synthetic/trusted events.

### 6. Local storage and privacy boundaries

Inventory settings, trusted domains, event logs, prompt outcomes, navigation
allowlists, adaptive scores, domain profiles, navigation-category profiles,
cooldown pairs, and all session maps. Trace every write and export.

Verify purpose-specific minimization, caps, TTLs, migrations, import validation,
complete behavioral reset, extension-removal behavior, and disclosure parity.
Persistent records should use the least-identifying representation possible;
do not apply a blanket URL sanitizer where exact targets are security-critical.

### 7. Permissions, reputation, and release profiles

Review the exact manifest permissions, host access, WAR exposure, DNR rules,
reputation asset, capability flags, onboarding/copy, and fresh-install defaults.

For interaction-only beta, prove DNR/reputation are absent or disabled and
unclaimed. For any future real-filter profile, verify feed licensing/provenance,
cardinality, bit density, sentinel membership, measured bloom FP, package
budget, cadence, rollback, and inbound-update authorization.

### 8. Build and supply chain

Review lockfile integrity, scripts that fetch or generate assets, deterministic
build/package behavior, source maps/debug flags, release version agreement,
CI permissions, artifact provenance, and secret handling. Confirm no remote code
or undeclared runtime network path exists in the reviewed profile.

## Minimum adversarial scenarios

- hostile page attempts to authorize its own blocked navigation or credential
  submission through synthetic and genuine user input;
- page moves or overlays injected UI immediately before a genuine click;
- blocked destination changes between warning, extension-origin confirmation,
  and replay;
- worker suspends during state hydration, authorization, rollback, and cleanup;
- two tabs/frames race messages and navigation state;
- page captures native APIs before patches and mutates prototypes afterward;
- bridge setup is raced, replayed, flooded, and restarted;
- import/export/reset is exercised with malformed and legacy state; and
- normal OAuth, payment, editor, SPA, password-manager, and accessibility
  journeys run with the reviewed beta profile.

## Required deliverables

- architecture/threat-model diagram for the reviewed commit;
- findings with severity, exploit preconditions, reproduction, and affected
  release profile;
- explicit disposition for every finding: fixed and retested, or maintainer-
  accepted with rationale and user-facing limitation;
- residual-risk and compatibility statement;
- package hash and configuration reviewed; and
- a clear recommendation limited to unlisted beta or public release.

Public launch remains blocked until high/critical findings are fixed and all
other findings have an explicit, documented disposition. A later material
change to decision authority, MAIN-world patches, bridge protocol, permissions,
storage schema, reputation/update channel, or release profile requires scoped
re-review.
