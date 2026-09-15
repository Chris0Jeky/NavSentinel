# Pending-decision create ordering (#686)

## Problem

A pending-decision create previously resolved browser tab/frame context before entering the
store's serialized mutation queue. Two creates for the same live document and decision kind
could therefore resolve out of order:

1. request A begins first and stalls during browser-context resolution;
2. request B resolves and stores its decision;
3. request A resumes and replaces B;
4. the content client retains B's ID while the popup lists A.

The release path still failed closed, but the legitimate prompt became stranded.

## Authority and ordering contract

The service-worker broker now admits creates through a FIFO tail keyed by:

- browser tab ID;
- sender frame ID;
- sender document ID;
- decision kind.

For one key, admission order covers the complete authority-producing path:

1. re-resolve the sender against the browser's current tab/frame snapshot;
2. fingerprint the verified context and exact destination inside the existing store queue;
3. replace or create the one live record for that scope;
4. persist the resulting bounded record.

A later same-scope create cannot begin context resolution until the earlier admitted create has
settled. Different tabs, frames, documents, and decision kinds retain independent tails.

## Lifecycle and failure behavior

The tab lifecycle generation is captured when the request is admitted, before it waits. If the
tab lifecycle changes while a request is queued or while hashing runs, the existing generation
guard returns `context-changed` and no record is written. A failed create is converted to a
settled queue tail, so it cannot poison subsequent requests. Empty tails remove themselves from
the broker map.

No release authority moved into the broker queue. Exact URL hashes, source/top origins,
document binding, delivery tokens, expiry, one-shot consumption, post-release context checks,
and fail-closed delivery remain owned by the existing store and consume path.

## Regression proof

`tests/pending-decision-handlers.test.ts` deterministically holds request A's first
`getAllFrames` call, starts request B for the same scope, and proves:

- B does not start browser-context resolution while A is held;
- A creates first and B reports A as its replaced decision;
- the extension-origin list contains only B and its destination origin;
- B releases the exact later URL once;
- a second consume returns `missing`.

A dependency-free Node 22 harness using the real TypeScript sources reproduced the pre-fix
failure (`getAllFrames` was called twice before A was released) and passes after the repair,
including replacement identity and exactly-once release. Repository Vitest, lint, typecheck,
build, package, E2E, and performance-budget qualification remain required in hosted CI because
the supplied offline checkout did not contain a complete npm cache.

## Scope

This change does not add permissions, endpoints, telemetry, storage fields, retention, scoring,
UI, or navigation policy. It orders pending-decision creation within one service-worker broker
instance; it is not a general cross-context transaction primitive.
