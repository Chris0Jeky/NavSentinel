# Programme state

As of 2026-09-12, based on the reconciled #649 merge receipt
`c78ba99da5d3357833a5fcd3f4f09bdb255db7a6`, later #687 receipt
`63e3bbbc401f272e88abc88a4f890ba4003bdb1f`, later #655 receipt
`9b7ce93652b08c0e7f124f3ef132e46c6ab39909`, later #658 receipt
`8a9435349e0dcdbe834bfee2beeeccafd5b39ccf`, merged programme seed
`d2762f296b07bfd650971141bf9bf7a9b2c016b9`, and the live issue, milestone,
pull-request, and Actions inventory refreshed for the current #449
fixture-family vertical. Fetch `origin/main` before using this dated receipt as
an exact build identity.

## Seeded

- 168 stable scenarios across 21 families, with 168 malicious, benign, and mixed contracts retained locally.
- 31 stable capabilities across proving-ground, release-integrity, research, agent-future, and optional-native tracks.
- 11 outcome values and 8 ordered evidence states.
- 1,512 generated local work units, nine for each scenario. They are not GitHub issues.
- 67 current-work mappings: 12 Gym levels, 23 RW journeys, 12 evasion fixtures, 5 ClickFix fixtures, 4 DoubleClickjacking fixtures, 9 evidence lanes, and 2 browser-suite mappings.
- 12 deduplicated issue themes and zero new issues created by the seed pass.

## Outcome board

The development-architecture migration assigns all 75 open issues and leaves no
unmilestoned queue:

- active M0 Proving Ground: 10;
- active M1 unlisted-beta release integrity: 8;
- planned M2 interaction integrity: 12;
- planned M3 local evidence plane: 8;
- planned M4 efficacy and quietness: 14;
- gated M5 beta cohort and operations: 1;
- passive maintenance: 4;
- frozen post-beta research: 18.

Seven obsolete or absorbed issues were closed after preserving their evidence
or successor: #244, #245, #246, #374, #421, #422, and #439. The complete
classification and applied GitHub receipt live under
[`docs/development-architecture/`](../development-architecture/README.md).
Only M0 and M1 are active; #417 is the bounded test-methodology exception and
does not activate M4 detector tuning.

## Evidence ceiling

All 168 canonical scenarios remain `UNMODELLED`. Existing artefacts are reconciled separately: 63 mappings are `MODELLED`, 2 are `UNMODELLED`, and 2 bounded mappings are `REGRESSION_PROVEN`. No scenario is claimed as browser-proven, efficacy-measured, release-eligible, universally secure, or anonymous.

The historical corpus result is `INVALID`. The historical false-positive result is `STALE`. The external live-site check and local event-coupled benchmark are `UNVERIFIED`. Bundled Chromium regression is not owner Chrome, current human Gate-3, or open-web evidence.

The first #449 vertical adds one loopback-only typed sink and independent wrong-target navigation oracle. Its attack baseline reaches `HARM_REACHED`; the protected attack and mixed runs produce `BLOCKED_PRE_HARM`; the benign rerender produces `NO_SIGNAL` and remains usable. This gives F-02 `FIXTURE_PROVEN` evidence and the bounded F-03/F-04 lane `REGRESSION_PROVEN` evidence. The canonical imported scenario snapshot remains `UNMODELLED`; the repository-current evidence is recorded in the separate mapping registry.

The first #186 bridge-peer ordering slice uses the release extension, Playwright bundled Chromium 143.0.7499.4, one loopback-only page, hard-coded synthetic bridge values, and a DOM-only authority receipt. The earliest normal authored-page peer sent its init but received no challenge in ten fresh profiles; the real isolated bridge became ready every time. A benign trusted click remained usable, and a post-readiness trusted-click peer was also rejected without a challenge or protection-lowering acknowledgement. This completes the repository-current `NS-ADV-SELF-004-01-MODEL` slice only; the canonical imported scenario snapshot remains `UNMODELLED` and the evidence is recorded in the separate mapping registry. The harmful `02-ATTACK` baseline did not reproduce, and no privileged pre-page injection was used to force it. The exact-head rerun started the Proving Ground deny proxy before Chromium, forwarded only the declared loopback origin, recorded zero fixture network violations, and retained 139 blocked browser-platform attempts. Same-session replay, a genuinely page-reachable pre-page actor, branded Chrome, content-script reload, and authenticated recovery remain open under #175/#186, so C-04 stays `MODELLED` and beta-blocking. PR #602 landed the model lane; PR #603 merged the fenced methodology repair as `ccff3d1c3f920ab8cbf1907ec31d6f1c93e9f018`, and final `main` CI run `33328852994` passed Build / Unit and E2E.

The original four ClickFix fixtures now use only an inert sentinel or local static control. Twelve evasion, seven core, and two RW fixtures now share a loopback-only typed target contract. At exact code head `b8a87caf67fad373d2b3e1d35180b64ff901a32b`, the interaction-only release-eligible build in bundled Chromium 143.0.7499.4 completed the composite representative's attack, protected, benign, and mixed arms with sink-enforced one-use target authorities, a test-run TTL, zero fixture-network violations, and zero invalid sink attempts. The benign task reached its sink without UI intervention and persisted one `nav_silent_allow` event, so its truthful outcome is `OBSERVED`, not `NO_SIGNAL`. The retained receipt SHA-256 is `6714563aa23497c69e1fa563fa27296fb82abe71945f94fa2e3abe573534c2df`; its Git fixture hash `967aabfce145b9b3adfb6477f4d69cabd93b74f4197566d4a75e8cb14ac620d3` was independently reproduced, and 56 Chromium platform connection attempts were denied before egress. Earlier local receipts with checkout-dependent hashing, unqualified profile state, incorrect benign outcome, descriptive-only use counts, or an inaccurate arm-lifetime label are `HARNESS_INVALID` and superseded. The RW-01 and RW-06 regression journeys now assert accepted benign local sinks and blocked typed harm follow-ups while remaining `MODELLED`; no mapped legacy destination remains on a safety hold. ClickFix remains browser detection evidence, not OS-paste prevention or real-provider browser evidence, and the evasion, core, and RW fixture families remain `MODELLED` rather than mutation-robustness evidence.

The fifth ClickFix fixture models `NS-ADV-CLIP-005`: a native manual copy of a benign case token, three deterministic local UI updates, and a delayed replacement with the exact inert sentinel. Its extension-disabled arm reaches a one-use `inert-shell-paste` sink (`HARM_REACHED`). The release-extension arm shows the expected ClickFix warning while the user stops before the simulated paste (`WARNED`); the clipboard remains rewritten, so this is not a prevention claim. The matched benign arm performs its own delayed page-originated rewrite to a harmless locally formatted case token, remains quiet, and reaches only its benign sink (`OBSERVED`); the mixed arm shows the warning and completes only the benign OTP consequence (`WARNED`). A pre-launch deny proxy and browser route allow only the exact loopback fixture and sink origins. The runner cannot reject a stale release-eligible `extension/dist`, so its diagnostic attachments declare `evidenceValidity: UNVERIFIED`, `promotionCeiling: MODELLED`, and `provenanceBound: false`; the registry mirrors that machine-checked ceiling. Native/OS paste destinations, a user ignoring the warning, branded Chrome, open-web behavior, and adjacent timing/focus mutations remain unproved.

## Live security tracker

This tracker was refreshed from the listed merge receipts on 2026-09-12. The
browser candidates #600, #609, #636, #640, #641, #643, #644, #649, #657, #608,
and #655 are merged. Their owner-installed Chrome checks remain consolidated in
the seven explicit **OPEN — not run** AI-47 rows in
[`ACTION_ITEMS.md`](../../ACTION_ITEMS.md); no owner result is inferred from a
merge or from automated Chromium/CI.

The following security-relevant candidates are tracked here. #637 is
**CLOSED/implemented via #649**, not an active residue route. #658 is merged;
its AI-47 child result remains **OPEN — not run**. The head and merge-SHA columns
separate reviewed branch identity from integrated `main` identity.

| PR | Scope | Head at refresh | Base at refresh | Live state | Merge SHA |
| --- | --- | --- | --- | --- | --- |
| #649 | Child-frame form target allowance | `04fde241cda6d313b042049c3e118b02381c8954` | `595903af89ff3bfb526e71de68f71f8c9459e6d1` | MERGED; no owner observation | `c78ba99da5d3357833a5fcd3f4f09bdb255db7a6` |
| #687 | Delayed clipboard rewrite adversarial lane | `b43de5d82c599f7e2b32e6d7e81668b308ec127d` | `c78ba99da5d3357833a5fcd3f4f09bdb255db7a6` | MERGED test-only; `MODELLED` evidence and `UNVERIFIED` diagnostic; no owner Chrome or OS-prevention claim | `63e3bbbc401f272e88abc88a4f890ba4003bdb1f` |
| #655 | Imported integer Options log limit | `d00da7499ba755de05f47fd67e2a05ca5b94dc75` | `63e3bbbc401f272e88abc88a4f890ba4003bdb1f` | MERGED; AI-47 row 6 remains **OPEN — not run** | `9b7ce93652b08c0e7f124f3ef132e46c6ab39909` |
| #658 | Conditional same-field Options writes | `0dc62f62e722de651169d3646669c0faf06fbd24` | `9b7ce93652b08c0e7f124f3ef132e46c6ab39909` | MERGED; AI-47 row 6 remains **OPEN — not run** | `8a9435349e0dcdbe834bfee2beeeccafd5b39ccf` |

The #649 child-form checks are now subject to AI-47 row 4, which remains
**OPEN — not run** until Chris records the observation. #687 is merged test-only
work; its `MODELLED` evidence and `UNVERIFIED` diagnostic do not establish owner
Chrome behavior, OS-paste prevention, or a release claim. Generated views now
link `MAP-CLICKFIX-05` to #687; this traceability repair does not promote the
diagnostic beyond its machine-checked `MODELLED` ceiling.

## Prioritized open follow-ups

These are live routing entries, not implementation or acceptance claims:

1. #688 — effective submitter authority.
2. #691 — export privacy/correctness.
3. #684 — receipt integrity.
4. #692 — release clean gate.
5. #686 — pending navigation ordering.
6. #690 — autosave/import ordering.
7. #689 — export boundary.
8. #693 — mutation-observer test determinism.
9. CLIP-005 — timing, focus, and ignore-warning mutations.

`NEXT_WORK.md` owns this execution order. #572 remains parked on SP-F-013 and
#599 remains outside the one-time browser-queue authorization. C-04
authenticated-recovery and live-port-death work remains open without
manufacturing reachability; owner and external gates remain in `ACTION_ITEMS.md`.

## Active authority

- Live source, tests, GitHub, [Project_Roadmap.md](../Project_Roadmap.md), and current owner gates outrank this programme state.
- [Development architecture](../development-architecture/README.md) provides
  milestone routing and trust-boundary contracts; it is not another roadmap or
  human queue.
- Release-integrity blockers, including bridge identity/recovery and extension-origin protection-lowering decisions, retain their existing homes.
- [ACTION_ITEMS.md](../../ACTION_ITEMS.md) remains the only human-action queue.
  Its cursor remains AI-19 and the named browser checks are consolidated under
  AI-47; this programme refresh closes no human decision or manual browser check.
- The release, research, proving-ground, and optional-native profiles remain separate. The #449 vertical changes no extension runtime behavior, permission, remote service, or committed build output.

## Source boundary

The supplied `RESOURCES/DefenseVectors` bundle physically contains seven files. It advertises capability, evidence-state, backlog, schema, and broader source artifacts that were not included. The missing registries were reconstructed deterministically from the supplied master and seed brief, and the limitation is recorded in [registry/SOURCE_PROVENANCE.json](registry/SOURCE_PROVENANCE.json). The supplied validation report could not be rerun against absent upstream files.
