# Development system architecture

This document records target boundaries for delivery. Target contracts are not
authorization to implement a capability, add a permission, change a release
profile, or cross an owner/browser/measurement/external gate.

## Global authority and consequence path

```text
human trusted input / page script / automation
    -> isolated controller + MAIN-world untrusted sensor
    -> validated, document-bound bridge
    -> consequence mediator
    -> service-worker authority
    -> context-bound pending decision
    -> extension-origin decision UI
    -> one-shot exact capability
    -> consequence executor
```

Governing invariants:

- MAIN-world code may observe and intercept page behaviour; it cannot lower
  protection or authenticate itself as the isolated controller.
- Page-injected UI may warn, describe, cancel, or direct the user to the
  extension surface. It cannot allow, proceed, trust, resume, or execute a
  security-relevant Undo.
- The service worker owns security-sensitive lifecycle state and exact
  capabilities. Every grant binds tab, frame, document/navigation, source,
  destination, action, expiry, and one-time consumption.
- A dead, missing, or degraded bridge cannot silently become an allow.
- Registrable domains inform relationship policy; they are not exact action or
  document identity.

## Shared evidence path

```text
scenario registry
    -> attack / benign / mixed fixture contracts
    -> trusted browser driver + exact artifact
    -> product events + independent typed sink receipts
    -> outcome classifier
    -> exact-head evidence receipt
    -> evidence index and claim gate
```

Product events are observations, not verdicts. Momentary hiding is not sustained
remediation. Rollback is post-commit containment. Harness/test invalidity is an
explicit outcome. A valid survivor lowers the evidence state.

## Shared context target

```ts
type BrowserContextKey = {
  tabId: number;
  frameId: number;
  documentId?: string;
  navigationId: string;
  sourceOrigin: string;
  destinationOrigin?: string;
  actionId: string;
};
```

This is a convergence target for new work, not authorization for a broad event
or Signal Fabric refactor.

## M0 architectures — Proving Ground

1. **Scenario contracts:** canonical registry plus attack, benign, mixed,
   mutation, forbidden-operation, supported-profile, and evidence-ceiling fields.
2. **Hermetic sinks:** typed loopback-only endpoints, explicit arming, one-use
   authority where needed, denied external egress, and minimal receipts.
3. **Trusted driver:** persistent browser context, exact built artifact, native
   pointer/keyboard input, explicit seam readiness, and deterministic ownership.
4. **Independent harm oracle:** product events and sink receipts are evaluated
   separately; neither can self-promote to protection evidence.
5. **Mutation/holdout:** deterministic adjacent variants, separate construction
   and holdout sets, retained seeds, and automatic evidence downgrade.
6. **Receipt/CI topology:** ignored exact-head receipts, serial persistent contexts
   by default, no retry-as-determinism, explicit platform support, and classified
   failures.

## M1 architectures — Release integrity

1. **Bridge state:** `STARTING -> ACTIVE -> RECOVERING -> FAILED_CLOSED`, with
   document-bound rebind and bounded recovery. Critical consequence signals have
   reserved capacity; routine pressure cannot displace them.
2. **Pending-decision broker:** worker-owned opaque capability, exact context,
   short TTL, current-document verification, and one-time consumption from an
   extension-origin surface.
3. **Passive-before-activation:** preferred release lifecycle registers protection
   content scripts only after extension-origin disclosure and affirmative activation,
   then unregisters and clears ephemeral state on revocation.
4. **Local-data lifecycle:** every store declares purpose, schema, size/row bound,
   URL precision, retention/TTL, import/export rule, reset membership, migration,
   and failure semantics.
5. **Release truth:** source commit -> interaction-only receipt -> package and
   permission checks -> privacy inventory -> store copy -> claim gate -> owner and
   external gates.

## M2 architectures — Interaction integrity

1. **Consequence mediator:** classifies same-tab navigation, child tab, opener,
   popup, submit, clipboard, overlay, and permission consequences before policy.
2. **Navigation authority ledger:** exact requested context and destination,
   action binding, TTL, one consumption, and invalidation at document/history
   boundaries. Modified clicks never grant broad opener authority.
3. **Suppression-group ledger:** bounded owned entries, original state, grouped
   reverse-order Undo, sustained checks, page-owned-change precedence, and pruning.
4. **Recovery hierarchy:** informational page status; browser-action indication;
   extension-origin consequential actions; keyboard/screen-reader parity; no
   timeout-triggered action.
5. **Settings transactions:** worker-owned leaf patches, per-field revisions,
   dirty-field conflict disclosure, canonical defaults, and separate configuration
   versus behavioural-data reset.

## M3 architectures — Local evidence plane

1. **Bounded event store:** versioned sanitised records with deterministic eviction,
   explicit event/outcome/correction linkage, and worker-owned clear/import paths.
2. **Projection layer:** Current Page, Decision Journal, review queue, Protection
   Center, and export derive from one canonical source without inventing facts.
3. **Data Flow Lens:** category -> source/actor -> destination/channel -> trigger ->
   decision -> evidence quality (`observed`, `correlated`, `inferred`, `unknown`).
4. **Correction model:** should-block, should-allow, uncertain, Undo, Allow once,
   and expiry are later facts; they do not rewrite the original decision.
5. **Explicit export:** user selection, allowlist serializer, count/byte cap,
   human preview, and local file/copy only. Raw DOM, values, clipboard content,
   queries, bodies, cookies, screenshots, and blanket logs remain excluded.

## M4 architectures — Efficacy and quietness

1. **Corpus v2:** committed manifest/hashes, faithful hostname routing, static and
   dynamic variants, trusted input, inert sinks, and protected-versus-fired outcomes.
2. **Benign journey corpus:** SSO/OAuth, payment/3DS, SPAs, cloud login, password
   managers, accessibility, popups, media/downloads, and enterprise redirectors.
3. **Comparator runner:** pre-registered cases across branded Chrome/native,
   NavSentinel, and combined arms with exact versions, modes, and consequences.
4. **Claim gate:** each wording maps to scenario families, minimum evidence, sample
   size/confidence, comparator, limitations, and allowed publication state.
5. **Measurement-gated changes:** attack recall, benign interruption, latency,
   reason attribution, holdout, confidence/sample size, and rollback plan before
   scoring or detector changes.

## M5 architectures — Beta operations

1. **Release train:** exact candidate -> reproducible package -> security/privacy
   checks -> owner Chrome -> external review prerequisite -> tag/release -> unlisted CWS.
2. **Cohort evidence:** explicit invitations, activation, D14/D30 status, reasons,
   severe compatibility events, volunteered redacted diagnostics, and support timing.
3. **Support/vulnerability response:** private intake, severity/response targets,
   false-positive and diagnostic guides, known limits, and release support window.
4. **Update/rollback:** signed store distribution, source-to-package receipt,
   previous-known-good package, migration rollback, and bounded capability disable.
5. **External review target:** exact commit/package, permissions/profile, bridge,
   decision authority, world boundaries, storage/export, release process, and
   current Proving Ground cases.

## Frozen R1 promotion boundary

Semantic/visual models, trust/recovery/guardian systems, agent conduct, remote
rule packs, native companion, and mobile remain design options only. Promotion
requires a falsifiable experiment, current valid evidence, privacy and permission
review, a maintenance owner, a kill criterion, and an explicit owner decision.
