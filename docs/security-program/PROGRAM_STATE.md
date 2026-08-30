# Programme state

As of 2026-08-30, based on merged programme seed `d2762f296b07bfd650971141bf9bf7a9b2c016b9` and the live issue and pull-request inventory refreshed for the first #449 vertical.

## Seeded

- 168 stable scenarios across 21 families, with 168 malicious, benign, and mixed contracts retained locally.
- 31 stable capabilities across proving-ground, release-integrity, research, agent-future, and optional-native tracks.
- 11 outcome values and 8 ordered evidence states.
- 1,512 generated local work units, nine for each scenario. They are not GitHub issues.
- 64 current-work mappings: 12 Gym levels, 23 RW journeys, 12 evasion fixtures, 4 ClickFix fixtures, 4 DoubleClickjacking fixtures, 7 evidence lanes, and 2 browser-suite mappings.
- 12 deduplicated issue themes and zero new issues created by the seed pass.

## Evidence ceiling

All 168 canonical scenarios remain `UNMODELLED`. Existing artefacts are reconciled separately: 61 mappings are `MODELLED`, 2 are `UNMODELLED`, and the bounded C-10 overlay nesting vertical is `REGRESSION_PROVEN`. No scenario is claimed as browser-proven, efficacy-measured, release-eligible, universally secure, or anonymous.

The historical corpus result is `INVALID`. The historical false-positive result is `STALE`. The external live-site check and local event-coupled benchmark are `UNVERIFIED`. Bundled Chromium regression is not owner Chrome, current human Gate-3, or open-web evidence.

The first #449 vertical adds one loopback-only typed sink and independent wrong-target navigation oracle. Its attack baseline reaches `HARM_REACHED`; the protected attack and mixed runs produce `BLOCKED_PRE_HARM`; the benign rerender produces `NO_SIGNAL` and remains usable. This gives F-02 `FIXTURE_PROVEN` evidence and the bounded F-03/F-04 lane `REGRESSION_PROVEN` evidence. The canonical imported scenario snapshot remains `UNMODELLED`; the repository-current evidence is recorded in the separate mapping registry.

The first #186 bridge-peer ordering slice uses the release extension, Playwright bundled Chromium 143.0.7499.4, one loopback-only page, hard-coded synthetic bridge values, and a DOM-only authority receipt. The earliest normal authored-page peer sent its init but received no challenge in ten fresh profiles; the real isolated bridge became ready every time. A benign trusted click remained usable, and a post-readiness trusted-click peer was also rejected without a challenge or protection-lowering acknowledgement. This completes the repository-current `NS-ADV-SELF-004-01-MODEL` slice only; the canonical imported scenario snapshot remains `UNMODELLED` and the evidence is recorded in the separate mapping registry. The harmful `02-ATTACK` baseline did not reproduce, and no privileged pre-page injection was used to force it. The fixture did not observe or deny Chromium and extension background requests, so network observation is `UNAVAILABLE` and this slice makes no clean-egress claim. Same-session replay, a genuinely page-reachable pre-page actor, branded Chrome, content-script reload, and authenticated recovery remain open under #175/#186, so C-04 stays `MODELLED` and beta-blocking.

Four ClickFix fixtures now use only an inert sentinel or local static control, leaving 21 mapped legacy Gym pages on a machine-checked external-destination hold. ClickFix remains browser detection evidence, not OS-paste prevention or real-provider browser evidence.

## Active authority

- Live source, tests, GitHub, [Project_Roadmap.md](../Project_Roadmap.md), and current owner gates outrank this programme state.
- Release-integrity blockers, including bridge identity/recovery and extension-origin protection-lowering decisions, retain their existing homes.
- [ACTION_ITEMS.md](../../ACTION_ITEMS.md) remains the only human-action queue. Its cursor remains AI-19; this seed closes no human decision or manual browser check.
- The release, research, proving-ground, and optional-native profiles remain separate. The #449 vertical changes no extension runtime behavior, permission, remote service, or committed build output.

## Source boundary

The supplied `RESOURCES/DefenseVectors` bundle physically contains seven files. It advertises capability, evidence-state, backlog, schema, and broader source artifacts that were not included. The missing registries were reconstructed deterministically from the supplied master and seed brief, and the limitation is recorded in [registry/SOURCE_PROVENANCE.json](registry/SOURCE_PROVENANCE.json). The supplied validation report could not be rerun against absent upstream files.
