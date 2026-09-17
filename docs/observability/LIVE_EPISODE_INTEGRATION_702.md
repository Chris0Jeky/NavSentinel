# Next live-episode integration slice (#702)

Status: implementation contract only. No live collector is enabled by #704 or the
scene-view continuation. Do not describe the synthetic diagram as an everyday
browsing monitor. Existing #455 (activation/consent), #591 (feedback/export) and
#239 (decision completeness) own their respective sources of truth.

## Narrow first deliverable

A read-only adapter consumes existing minimized decision events only after explicit
session start and already-satisfied product consent. No broad DOM, network, clipboard
or screenshot capture is required. The adapter has no reference to allowance minting,
policy mutation or detector-scoring functions. Subscription errors do not block the
protection path; they close the observation epoch with a gap.

Proposed session states are `idle`, `recording`, `stopped`, `expired`, `revoked`.
Start requires consent and creates a fresh random local epoch. Stop unsubscribes
synchronously. Expiry and revocation use the same unsubscribe path; revocation also
invalidates prepared exports. Clear removes episodes and their labels through the
existing behavioral-data clear path rather than leaving a secondary store behind.
A restart never silently resumes a recording session.

Use a bounded default of 15 minutes, 1,000 minimized records or 1 MiB of UTF-8 data,
whichever is reached first; show the reason for stopping and discarded-record count.
These are proposed session budgets to validate against the selected storage seam,
not current extension settings. No `unlimitedStorage`, history or debugger permission
is justified by the first slice.

## Event and feedback boundaries

Consume safe category/reason/outcome codes and per-session pseudonymous tab/document/
frame epochs. Do not export hostnames or other identifiers by default; later safe-host
projection must reuse the reviewed canonicalization/export contract rather than an
independent regex. Reject payload fields rather than copying extra object properties.
URL queries/fragments, DOM/text, form/clipboard values, cookies, access tokens,
request bodies and blanket console logs are not admitted at the producer boundary.

Retain observer health and document replacement as events. `not observed`, `not
supported`, `dropped` and `allowed` are different states. Existing minimized events
cannot prove that all data transfers were seen or stopped. Third-party contact alone
is not a malware verdict. Render known limitations beside the episode, not only in
an export appendix.

Feedback is an annotation referencing immutable event/episode IDs with user provenance:
Should allow / Should block / Unsure. It uses #591's persistence and clearing behavior.
Labels never rewrite the original event or automatically alter thresholds. A false-
positive report and a measured defensive failure remain separate record types.

## Export transaction

Prepare one minimized snapshot, validate record and byte budgets, and display its
exact contents. Save the prepared bytes, not a second read from changing storage.
Cancel, expiry, revocation or a schema error destroys the prepared snapshot. Local
save is not GitHub submission or training donation; no implicit network call follows.
Reuse #696's immutable reviewed-byte boundary once that PR is reconciled.

## Required tests before the runtime PR can be accepted

1. No subscriptions or observations before both activation consent and explicit start.
2. Start/stop/start isolation; navigation/frame epochs; worker restart; no auto-resume.
3. Immediate unsubscribe on stop/expiry/revocation, including an in-flight callback.
4. Byte/count/duration caps with loss counts, full storage and failed write behavior.
5. Hostile imported metadata and identifier-shaped secrets cannot bypass the producer
   allowlist; export contains exactly the previewed bytes, and revocation invalidates it.
6. Labels clear with episodes, remain separate from original evidence and never affect
   an allow/block decision; ordinary navigation is unchanged with observer on or off.
7. Keyboard, status, accessible start/stop controls, and user Gate-3 on the exact built
   artifact because this future slice changes shipped UI and runtime subscriptions.

A trace adapter, session lifecycle and UI should be reviewed together as one runtime
slice after the consent and feedback seams are ready. Until then the explicit offline
inspector remains independently useful and does not create a second recording system.
