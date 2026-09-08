# Upstream agent handoff

You are reviewing an isolated NavSentinel vision prototype bundle. Do not replace the existing extension, copy its heuristic weights into production, weaken a gate, silently enable telemetry, or seed duplicate backlog items.

## First pass

Read `README.md`, `REALITY-MAP.md`, `SOURCE-GROUNDING.md`, `ARCHITECTURE.md`, the showcase routes and validation receipts. Then fetch the actual current upstream HEAD, issues, milestones, open PRs and owner decisions. Treat the research snapshot as dated context, not current execution authority.

Run the no-dependency Node suite and rebuild the standalone prototypes. Open all three UIs. Evaluate whether the experience makes intent, consequences, uncertain evidence and recovery legible. Preserve the distinction between model evaluation, page observation, independent sink receipts and actual OS enforcement.

## Suggested adoption boundary

Keep the bundle in `experiments/vision-lab/` or a separate experimental branch. Create a concise design-review note mapping reusable ideas to existing issues before adding anything new. Do not carry generated `.local` data or tokens into version control.

The strongest near-term candidate is the **local evidence workspace**, not replacement detector logic: source/action/destination projection, separate corrections, limited exports, explicit coverage inventory and a useful Data Flow Lens. Map to M3/#591/#592 and the current bounded event-store design. Work remains gated by current priorities and the owner’s decision.

For browser UI, treat the guardian panel and narrow trusted controls as design references for #601/M1/M2, not a bridge implementation. Reuse actual upstream pending-decision authority. Preserve tab/frame/document/navigation/action binding, TTL, single use, exact destination, stale-context rejection and no automatic replay.

For the wildcard, promote only a falsifiable cooperative-agent experiment: one registered client, one observed consequence adapter, an actual executor whose side effects are independently measured, explicit registration/revocation, and a kill criterion. Do not describe the inert executor as OS protection. Keep arbitrary commands, arbitrary URL fetches, filesystem access and public exposure out of scope until their threat model is separately reviewed.

## Required review work

1. Reconcile names, signal/receipt schema and lifecycle ownership with current upstream types; do not broad-refactor the pinned content chunk just to accommodate a prototype.
2. Split reusable renderer views and projections out of the prototype’s central `web/app.js` before production integration. Adopt the repository’s existing framework/build/state conventions rather than shipping a parallel permanent UI stack.
3. Replace in-memory/file-lab assumptions with the upstream bounded store and revisioned settings transactions. Define migrations, conflict behavior, reset membership, crash recovery and deletion semantics.
4. Test browser adapters with real branded Chrome, independent sinks, keyboard/pointer input, timing variation, worker suspension, nested frames, transient/reappearing layers, page tampering and a retained benign corpus. Keep the known programmatic-submit survivor visible.
5. Before any native promotion, choose one platform and an actual OS-supported enforcement boundary. Threat-model token storage/ACLs, consent, signing, update/rollback, crash semantics and same-user process compromise. The optional Electron wrapper is not such an adapter.
6. Produce small reviewable PRs. Keep release evidence, public claims and operational docs tied to exact artifacts. Do not mark existing issues complete solely on the strength of the prototype’s tests.

## Acceptance report

Return: which ideas were retained/rejected and why; issue reuse map; actual code seams; one smallest useful vertical per retained idea; attack/benign/mixed tests; exact boundary limitations; changed files; test commands/results; remaining human decisions. Human-facing text should be direct and compact.

Never turn a failed or environment-blocked check into a pass. The delivered 89 Node tests and 52 UI checks do not include an unpacked-extension runtime pass or a native Electron launch.
