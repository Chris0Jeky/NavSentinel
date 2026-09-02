# Development architecture decisions

This file records the 2026-08-30 setup interpretation. It does not replace
[`docs/agentic/DECISIONS.md`](../agentic/DECISIONS.md) or create runtime authority.

## Adopted for project organisation

| ID | Decision | Basis |
| --- | --- | --- |
| DA-001 | Milestones are closable outcome gates; subsystem/domain stays in architecture and labels. | Owner requested milestone structure; consistent with Product Strategy outcome gates. |
| DA-002 | Only M0 and M1 are active. #417 may advance methodology without activating detector tuning. | Keeps proof and release integrity ahead of new capabilities. |
| DA-003 | Maximum two runtime-affecting PRs across M0/M1 and one per high-risk seam. | Current roadmap WIP posture; parked work has an explicit resume condition. |
| DA-004 | The 168 scenarios and 1,512 work units stay local; GitHub receives bounded verticals only. | Existing security-programme rule. |
| DA-005 | The required-read architecture head stays short and routes to current authority. | #437 standing-context objective; avoids another roadmap/log. |

## Existing product/evidence direction restated

| ID | Direction | Status |
| --- | --- | --- |
| DA-006 | MAIN world is an untrusted sensor; page-injected UI is not an authorization boundary. | Existing RI-01 direction. |
| DA-007 | Allow/proceed/trust/resume/security Undo require extension-origin, exact-context, one-shot authority. | Existing release direction. |
| DA-008 | Product events do not prove protection; evidence may move backward after a survivor or invalid harness. | Adopted by the security programme. |
| DA-009 | Local data remains bounded, purpose-limited, sanitised, deletable, and explicitly exportable. | Existing privacy direction; rejects the old “privacy-unconstrained locally” premise. |
| DA-010 | Scoring/detector tuning waits for valid attack and benign measurement. | Existing D25/roadmap direction. |
| DA-011 | Post-beta native, ML, mobile, remote-pack, guardian, self-tuning, and agent-conduct implementation remains frozen. | Existing Product Strategy/Horizon policy. |

## Design targets, not implementation approvals

- one context identity carried across consequential actions;
- one bounded typed event model feeding multiple read projections;
- dynamic content-script registration for passive-before-activation, subject to
  browser support, minimum-version proof, privacy review, and owner/browser gates;
- a machine-readable claim-to-evidence contract;
- an extension-origin pending-decision flow completing the dormant broker.

## Live deviations from the dated package

- #458 remains open and moves to M0: PR #534 proved and documented the boundary,
  but the issue's minimum/current branded-Chrome matrix remains unverified.
- #176 remains in M1: current session state still persists exact URLs for rollback,
  forward, last-URL, and OAuth correctness; purpose, TTL, and field minimisation
  still require a bounded privacy decision rather than an inferred close.
- #560 is classified in M2 but is not narrowed until #600 merges; its current body
  still accurately describes the remaining compact lifecycle.
- #523 remains open until #599 merges after explicit owner policy acceptance and
  exact-head branded-Chrome evidence.
- PR #605 is a new M0 test-only vertical. Its current Build / Unit failure is the
  already-tracked #595 deterministic MutationObserver synchronization defect.
- The validated source package stays under ignored `RESOURCES/`; it is not copied
  wholesale into the tracked required-read chain.

## Owner and external gates preserved

- `Chris0Jeky/NavSentinel::ACTION_ITEMS.md::AI-19`: product name/clearance.
- `Chris0Jeky/NavSentinel::ACTION_ITEMS.md::AI-24`: optional merged-result Chrome confirmation.
- PR-specific Gate-3 items, including #600 and future #523/#599 evidence, remain human-owned.
- Release-profile, permission, runtime-network, default-on, data-submission,
  native/ML, and public-claim changes require a new explicit owner decision.
- Exact-package external security review remains required before public launch.
