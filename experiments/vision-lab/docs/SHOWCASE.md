# Showcase routes

## Route A: a quiet browser guardian

Open `NavSentinel-Browser.html`. The example session is explicitly synthetic.

1. Leave **Layered overlay** selected. Press **Inspect layer**, then **Run scenario**. The outline reveals the modeled hit area; the guardian explains the consequence.
2. Choose **Inspect decision**. Inspect the source/destination boundary, typed signals, observation quality and heuristic score. Add **Should allow** and see it preserved as a later fact, not a rewritten decision.
3. Close the drawer, use **Undo fixture cleanup**, and verify that no click is replayed.
4. Select **SSO / OAuth**, **Payment redirect**, or **Intentional new tab** to see ordinary intent allowed. The exact label comes from the scenario selector.
5. Select **First-time sign-in**. It asks for review. In **Trust & rules**, add `new-workspace.test` only to credential trust. Replaying now allows the fixture while the original review remains in the journal. Navigation trust alone does not resolve that credential review.
6. Open **Proving Ground**, run all 20 fixtures, and compare policies. The delayed-popup boundary becomes a Strict block; the benign redirect becomes a Strict interruption. These are contract comparisons, not efficacy rates.

## Route B: a desktop companion that explains, not intimidates

Open `NavSentinel-Desktop.html`.

1. Inspect **Coverage, not assumptions**. The browser build is separate, native shell/process sensing is simulated, and DNS/models are not installed.
2. Choose **Replay the sequence** on the verification incident. Two fixture stages are correlated into one investigation without pretending a system clipboard watcher is running.
3. In **Investigations**, inspect the recorded stages and explicit knowledge gaps.
4. In **Data Flow Lens**, select another scenario and click the source, signal, policy, and destination nodes. Evidence quality and action scope remain distinct.
5. In **Recovery room**, review the checklist and export the plan. No checkbox performs a system action.
6. In **Settings & data**, limit review-summary cards, export redacted evidence, and clear history without clearing preferences. Import preferences through a human-readable preview.

## Route C: the wildcard, a real local intent broker

The offline `NavSentinel-Intent-Relay.html` lets you inspect contracts, edit typed intent JSON, compare policies, and rehearse grants without a service.

For the live vertical:

```sh
node daemon/server.cjs
```

Open `http://127.0.0.1:4318/?mode=relay`. Connect using the operator token printed by that process. Keep tokens private; they are not included in this bundle.

1. Open **Requests** and send **A new destination**. The actual service returns a review.
2. Approve once, then consume. The service records an inert receipt; it does not contact the destination.
3. Consume again. The replay is rejected.
4. Send a new review and approve it. Choose **Try different document**. The exact-context check rejects and burns the grant.
5. Send the sensitive-upload or stale-context contract. No overridable capability is issued.
6. Inspect the service journal: decisions and subsequent authority events remain separate, hash-linked records.

In another terminal, `node examples/agent.cjs` exercises the client principal, automatic reference allowance, exact consumption, replay rejection and sensitive-upload block. The operator and client have different permissions.

## Route D: real DOM effects, separately gated

Load `extension/` unpacked in a dedicated Chrome profile. Start the Node service and visit `http://127.0.0.1:4319`. Enable that exact origin from the extension popup and reload.

Use the live fixture pages with the guard off and on. The local server holds independent consequence counters. Overlay cleanup should preserve the real Play target; mismatched-link and unsafe-submit fixtures should hold their captured consequences; benign navigation/form controls should still reach their sinks. The **Known survivor** explicitly calls `form.submit()` and should reach its sink: this records a limitation, not a protection pass.

`tests/live_extension.py` can automate these sensor-path comparisons on an unmanaged local test machine. Its recorded result in this delivery is **environment-blocked, zero live extension tests executed**. Popup permission UX, authoritative Undo, one-use Allow once, worker restart, child-frame behaviour and real Chrome still need the manual checklist.
