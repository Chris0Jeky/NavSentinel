# Project Overview

> **Maturity:** pre-alpha development project. This file describes implemented
> behavior, not validated efficacy or release readiness. Product direction and current gates
> live in [`Product_Strategy.md`](Product_Strategy.md).

## Summary

NavSentinel is a local-first Chrome MV3 extension designed to guard two high-risk browser surfaces:

- deceptive navigation attempts that try to move the user somewhere they did not clearly intend to go
- risky credential submissions that look like phishing or unsafe login handling

All scoring, prompting, persistence, and enforcement stay inside the extension. There are no
remote verdict services, telemetry pipelines, or password uploads.

## User-visible capabilities

### Navigation firewall

- observes pointer and keyboard activation context before navigation side effects occur
- computes a Click Deception Score (CDS)
- blocks or prompts on suspicious `_blank` links, popunders, programmatic popup attempts, delayed redirects, and delayed form submits
- rolls back some non-user-initiated redirects and offers an explicit proceed action
- remembers explicit per-site destination approvals in the navigation allowlist

### Credential guard

- intercepts password-form submits at capture time
- computes local risk from HTTPS state, cross-site action target, lookalike similarity, mixed scripts, punycode, deep subdomains, and trusted-domain state
- blocks with a modal prompt before risky submits proceed
- supports proceed-once and trusted-domain workflows
- warns when the user pastes into a password field on an untrusted domain

### Local operator surfaces

- popup for fast per-tab inspection and trust toggling
- options page for persistent configuration and inspection
- bounded local event log
- JSON import/export of the local configuration bundle

## Protection philosophy

- default to explainable heuristics rather than opaque remote classification
- prefer local, inspectable decisions over cloud lookups
- preserve legitimate user intent when it is explicit
- keep prompts actionable and bounded
- make risky decisions traceable through reason codes and event logs

## Effective deployment guidance

- use only as a development/dogfood build until the beta gates in
  `Product_Strategy.md` pass; do not rely on it as the sole security control
- use `smart` mode for controlled compatibility and regression testing
- use `strict` mode when validating new heuristics or running adversarial Gym scenarios
- keep the trusted-domain list small and deliberate
- treat the navigation allowlist as a site-specific exception list, not a global trust signal
- clear or export the event log during testing cycles so comparisons stay clean

## Current status

The merged `main` branch includes a substantial engineering baseline:

- hardened navigation interception across isolated-world and main-world surfaces
- credential-submit protection and trusted-domain workflows
- popup and options UI
- bounded local event logging
- packaging, CI, and strict type verification

It is not yet a released or validated product. Immediate blockers include:

- scripted page input can activate protection-lowering prompt/modal actions;
- RI-02 visual-sim excision is locally and artifact verified, but its required
  browser Gate-3 still precedes release-blocker closure;
- extension-origin prompt authority and other release-integrity work remain;
- the selected interaction-only profile excludes reputation runtime and assets,
  and RI-05 removed the placeholder DNR surface and its permissions;
- FP/TP and comparative efficacy evidence is incomplete;
- no external audit, tag, release, CWS listing, or external-user cohort exists;
  and
- the working product name requires clearance or replacement.

The next sequence is release integrity → narrow unlisted beta → real-user
evidence → one evidence-backed differentiator. North-Star/Horizon work is
frozen until that sequence produces a credible signal.

## Main code entry points

- `extension/src/content/capture_isolated.ts`
- `extension/src/content/main_guard.ts`
- `extension/src/content/credential_guard.ts`
- `extension/src/content/credential_modal.ts`
- `extension/src/popup/popup.ts`
- `extension/src/options/options.ts`
- `extension/src/shared/storage.ts`
- `extension/src/shared/allowlist.ts`
- `extension/src/shared/domain.ts`
- `extension/src/shared/scoring.ts`
- `extension/src/sw/sw.ts`

## Non-goals

- cloud telemetry
- remote reputation lookups
- password capture or storage
- broad browser-porting work before Chrome behavior is fully stabilized

Issue #555's first overlay-cleanup vertical adds an off-by-default control. It
hides a high-severity overlay identified after injection or an already-blocked
click, shows an Undo action, never replays the click, remains inert when the
setting or Navigation is off, and leaves the covered benign dialogs and widgets
usable. Future mechanisms will be selected from observed efficacy, safety,
user-control, and compatibility evidence.
