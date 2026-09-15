# Pending-decision create ordering (#686)

## Problem

Browser context resolution originally happened before the store mutation queue. Two
same-scope creates could therefore complete out of order and leave the popup listing a
worker decision for which the content client no longer held the raw destination.

The first FIFO repair ordered successful creates, but review found two remaining
fail-closed availability races:

1. an older create could become live, then a newer admission could fail context
   resolution; the content client ignored the older response while the worker retained it;
2. a previously live decision remained listable and consumable while a superseding
   same-scope create was unresolved.

## Latest-admission authority contract

Scope is `(tab, frame, document, decision kind)`. A structurally valid, authorized
create synchronously becomes that scope's latest admission. FIFO tails still serialize
side effects, but an older operation must prove that its admission token is still current
after every asynchronous authority-producing boundary.

A new admission performs three fail-closed actions:

- the content client burns every unreleased raw-URL slot in its document/frame before
  awaiting the worker;
- the worker removes and persists removal of any prior same-scope record before resolving
  the new browser context;
- list and consume paths suppress a scope while its replacement admission is active.

If the latest admission later fails, the predecessor stays retired. The product does not
resurrect an intent the page has already superseded. A successful replacement may still
report the retired opaque ID through the existing optional `replacedDecisionId` response.

If durable retirement itself fails, the worker retains an in-memory tombstone so the old
record is not listable or releasable. A later same-scope create retries retirement; tab
lifecycle cleanup removes the tombstone. A worker restart remains fail-closed because the
content client has already destroyed the raw URL capability.

Different tabs, frames, documents, and kinds keep independent admission tokens and FIFO
tails. Store writes remain globally serialized for session-state integrity.

## Lifecycle, delivery, and failure behavior

Admission currency is combined with the existing tab lifecycle generation. Either a
superseding admission or a tab lifecycle change produces `context-changed` before a stale
record can be written. Scope removal rolls back in memory if persistence fails.

Consume rechecks active replacement admission before destructive consumption and again
immediately before tab creation. The content boundary independently burns the raw URL on
supersession, so a restart or storage failure still fails closed rather than releasing an
obsolete destination.

Exact URL hashes, source/top origins, document binding, opaque tokens, expiry, one-shot
consumption, post-release browser-context checks, and destination-hash verification are
unchanged.

## Regression proof

Focused tests prove:

- delayed A plus admitted B rejects A and leaves only B releasable exactly once;
- a prior live record disappears while B is unresolved and remains retired when B's live
  context later fails;
- a failed retirement stays tombstoned and a clean retry converges on the latest intent;
- the content client rejects delivery of the prior raw URL immediately when B is admitted;
- a second consume remains `missing` and the later exact URL is the only created tab.

Hosted run `34984683176` proved the first three stale-admission regressions red against the
FIFO-only implementation while all 24 pre-existing focused tests passed. Normal exact-head
CI remains the source of truth for the complete unit, build, package, performance, and
browser suites.

## Scope

No permission, endpoint, telemetry, storage schema, retention, score, prompt policy, or
destination authority is added. This is an in-process latest-intent and persistence-ordering
boundary, not a cross-worker transaction guarantee.
