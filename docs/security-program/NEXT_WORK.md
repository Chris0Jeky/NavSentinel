# Next work

This is a short execution cursor, not a second product roadmap. Reconcile it
with live GitHub, [Project_Roadmap.md](../Project_Roadmap.md), the
[development architecture](../development-architecture/README.md), and owner
gates before starting a slice.

The 2026-08-30 administration pass assigns all 75 open issues: M0 has 10 and M1
has 8; only those two milestones are active. Planned M2/M3/M4, gated M5,
passive maintenance, and frozen R1 are not fallback queues. The exact receipt is
[`GITHUB_ADMIN_RECEIPT.md`](../development-architecture/GITHUB_ADMIN_RECEIPT.md).

As of 2026-09-12, the reconciled merge receipts are #649
`c78ba99da5d3357833a5fcd3f4f09bdb255db7a6`, #687
`63e3bbbc401f272e88abc88a4f890ba4003bdb1f`, and #655
`9b7ce93652b08c0e7f124f3ef132e46c6ab39909`. Fetch `origin/main` before using
this dated receipt as an exact build identity. The merged browser chain's seven
AI-47 rows remain **OPEN — not run** in `ACTION_ITEMS.md`; a merge or CI result
is not owner Chrome acceptance. #658 remains pending at local head `7bcf9a4` and
is **OPEN — not run** until it actually merges. #687 is merged test-only work:
its evidence stays `MODELLED` and its diagnostic `UNVERIFIED`; it is neither
owner Chrome evidence nor OS-paste prevention.

Issue #637 is **CLOSED/implemented via #649** and is not an execution route.
The live candidate and receipt tracker is [`PROGRAM_STATE.md`](PROGRAM_STATE.md).
There is still no owner Chrome, accessibility, release-signing, store, or
external-review acceptance recorded. #420 remains a bounded maintainer-headed
runner: it writes redacted local receipts but does not schedule, measure FP, or
claim Gate-3.

## Prioritized live cursor

These entries are routing and scope only; none claims implementation, a merge,
or an acceptance result.

1. **#688 — effective submitter authority.** Reconcile the exact current scope
   before starting a bounded slice.
2. **#691 — export privacy/correctness.** Preserve minimized, correct local
   evidence without inventing collection or sharing claims.
3. **#684 — receipt integrity.** Keep receipts source-bound and distinguish
   observed facts from generated or diagnostic output.
4. **#692 — release clean gate.** Reconcile the exact release-clean conditions;
   do not infer them from a merge or ordinary CI.
5. **#686 — pending navigation ordering.** Keep pending-decision order and
   lifecycle authority explicit.
6. **#690 — autosave/import ordering.** Preserve explicit import and saved-state
   ordering without treating pending #658 behavior as current-main evidence.
7. **#689 — export boundary.** Keep privacy and correctness boundaries local and
   separately evidenced.
8. **#693 — mutation-observer test determinism.** Make the test seam
   deterministic without broadening runtime authority.
9. **CLIP-005 — timing, focus, and ignore-warning mutations.** Keep this
   adversarial lane `MODELLED`; it does not prove browser efficacy or OS-paste
   prevention.
10. **Keep exclusions explicit.** #572 remains parked on SP-F-013 before AI-31;
    #599 remains outside the one-time browser-queue authorization pending its
    owner queue-policy choice.
11. **Close C-04 without manufacturing reachability.** Authenticated recovery
    and live-port-death work remain open; do not force a result with privileged
    pre-page injection or an artificial page-reachable actor.
12. **Respect human and external gates.** Resume
    [`ACTION_ITEMS.md`](../../ACTION_ITEMS.md) at AI-19, then AI-47. Only Chris
    may record browser observations; keep owner Chrome, accessibility,
    release-signing, store review, and external review open until directly
    evidenced.

Keep the #449 locality suite bounded and typed when a reconciled M0/M1 slice
reaches it: retain its `MODELLED` ceiling and local typed sinks rather than
turning it into a generic collector.
