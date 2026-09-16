# NavSentinel

> **Pre-alpha; not yet efficacy-validated, independently audited, distributed, or adopted.** `NavSentinel` is a working name pending clearance. Use the repository build for controlled development and dogfooding, not as a sole security control.

NavSentinel is a local-first Chrome MV3 interaction guard for deceptive navigation and risky browser actions. It checks consequential clicks, redirects, popup attempts, credential submissions, double-click attacks, and ClickFix-style clipboard traps before or immediately after they cross a security boundary.

Its emerging differentiator is not a growing list of heuristics. It is a system of **inspectable decisions and reproducible evidence**: the extension explains why it intervened, the Gym can replay attack and benign contrasts, the Observatory work can record bounded scenes and receipts, and release artifacts are expected to prove exactly which source and profile produced them.

[Product strategy](docs/Product_Strategy.md) ·
[Architecture and data flow](docs/Architecture_and_Data_Flow.md) ·
[Testing and Gym](docs/Testing_and_Gym.md) ·
[Privacy](PRIVACY.md) ·
[Security](SECURITY.md)

## Product promise

> An open-source, local interaction guard that checks consequential browser actions, explains interventions, and complements built-in browser protection without uploading browsing activity.

The current default is interaction-only: no reputation service, no remote telemetry, no password-value storage, and no runtime network lookup. A separate unpacked-only research profile contains a deterministic reserved-domain fixture for local experiments; it is explicitly not release-eligible.

## What the current build protects

- **Deceptive navigation:** hidden overlays, click retargeting, popunders, delayed redirects, synthetic popup attempts, suspicious `_blank` behavior, and selected cross-domain rollback cases.
- **Foreground overlay suppression:** optional, bounded removal of classifier-identified high-severity layers, including qualifying child-frame cases, with one grouped Undo and no synthetic click replay.
- **Programmatic navigation:** main-world interception of `window.open` and form submission. Chromium does not permit safe replacement of `location.assign` or `location.replace`; the documented service-worker rollback covers only a narrower subset after navigation.
- **Credential submissions:** local risk checks for insecure password posts, untrusted or lookalike destinations, suspicious cross-site actions, and selected paste risks.
- **DoubleClickjacking:** correlation across the main world, isolated world, and service worker for attacks that move a sensitive control under the second click.
- **ClickFix/fake CAPTCHA:** detection of deceptive instruction overlays combined with clipboard writes and “paste this command” flows.
- **Local operator surfaces:** popup, options, trusted-domain management, navigation allowlists, import/export, bounded local decision history, and prompt outcomes.
- **Build-profile receipts:** deterministic profile identity, with packaging restricted to the release-eligible interaction-only profile.

“Implemented” does not mean proven effective on the open web. The project still needs an honest beta, external review, real-user evidence, and release-integrity closeout before stronger claims are warranted.

## Modes and authority

### Navigation

- `Off` — no intervention; useful for controlled comparisons.
- `Smart` — intended default; blocks clear deception while allowing ordinary navigation and most legitimate new-tab flows.
- `Strict` — lower threshold for Gym and adversarial development.

### Credential protection

- `Off` — disables password-submit prompting and paste warnings.
- `Smart` — prompts on untrusted destinations and medium/high-risk submissions.
- `Strict` — more aggressive phishing-style test posture.

Trusted domains and the navigation allowlist are separate controls. Trusting a site to receive credentials is not the same as permitting one destination from one source after a navigation prompt.

Protection-lowering decisions must move toward extension-origin UI bound to the intended tab, destination, document, and one-use authority. Page-injected content can display context, but it must not silently become the source of authorization. Recent work on submitter overrides, mutation timing, document lifetime, serialized admissions, and one-use effective-form authority is part of that boundary; open work remains planned until merged and released.

## Evidence-first development

NavSentinel is developed as two cooperating systems:

1. **The Guard** — the MV3 extension, local policies, decision engine, operator UI, bounded logs, and release profile.
2. **The Evidence system** — deterministic Gym fixtures, adversarial campaigns, recorded scenes, DOM/timing traces, reason codes, proof receipts, and release-input attestations.

The evidence system is not a hidden telemetry service and must not gain authority to click, submit, install, package, release, or change protection settings. Its job is to make claims reproducible:

- what page state and user action were present;
- which DOM mutations and timing transitions occurred;
- which rule admitted, prompted, blocked, or rolled back the action;
- whether the result came from synthetic fixtures, a recorded campaign, or a live dogfood observation;
- which exact extension build, profile, and source inputs produced the result;
- what remains untested or ambiguous.

Current Observatory and campaign PRs are development infrastructure, not a public monitoring product and not evidence that the extension is ready for broad use.

## Direction

### Now: authority and release integrity

- Close protection-lowering authority gaps across forms, child frames, mutations, navigation, and document replacement.
- Bind prompts and decisions to the effective destination and the document/element state that was actually reviewed.
- Serialize competing decisions and make stale or reused authority fail closed.
- Prove package inputs, source identity, build profile, generated bytes, and publication receipts without granting the evidence tooling release authority.

### Next: replayable efficacy evidence

- Turn the Gym and real-world adversarial programme into bounded, versioned campaigns with attack/benign pairs.
- Capture scenes, DOM changes, timing, decision reasons, outcomes, and known limitations in a reviewable replay UI.
- Measure additive protection, interruption rate, comprehension, recovery, and quietness instead of counting blocked events as success.
- Separate synthetic, recorded, observed, and externally validated evidence.

### Then: an honest small beta

The narrow product path remains:

1. pass the release and authority blockers;
2. package one understandable interaction-only beta;
3. recruit roughly ten real users;
4. measure whether NavSentinel adds protection without becoming noisy or confusing;
5. fix the evidence-backed problems before adding broader reputation, cloud services, policy administration, or commercial layers.

See [Product_Strategy.md](docs/Product_Strategy.md) for the gates and non-goals.

## Build and run

```bash
npm install
npm run build
```

Load `extension/dist` from `chrome://extensions` with Developer Mode enabled. After every rebuild, click **Reload** for NavSentinel before reloading an open test page; reloading only the page can keep an old hashed content-script loader alive.

`npm run build` selects the release-eligible `interaction-only` profile. The following is for local research only and produces a non-release artifact:

```bash
npm run build:research-reputation
```

Useful commands:

```bash
npm run watch
npm run test
npm run test:e2e
npm run typecheck
npm run verify:versions
npm run package:ext
npm run gym:serve
npm run demo:showcase
npm run demo:showcase:record
```

Start the deterministic Gym with `npm run gym:serve`, then open its served index. It covers navigation, credentials, DoubleClickjacking, ClickFix, redirect chains, content fingerprinting, DOM mutation, pushState abuse, evasion composites, CSP/SRI, and the real-world adversarial fixtures.

## Repository map

- `extension/` — MV3 source, manifest, assets, and build output
- `gym/` — deterministic attack, benign, and edge-case fixtures
- `tests/` — Vitest logic tests and Playwright E2E coverage
- `docs/` — architecture, threat model, strategy, evidence, testing, release, and roadmap material
- `scripts/` — profile/build checks, packaging, research fixtures, benchmarks, and data updates
- `autodoc/` — agent-facing code orientation

Start with [docs/README.md](docs/README.md), then read:

- [Project overview](docs/Project_Overview.md)
- [Product strategy](docs/Product_Strategy.md)
- [Architecture and data flow](docs/Architecture_and_Data_Flow.md)
- [Intent model and scoring](docs/Intent_Model_and_Scoring.md)
- [Testing and Gym](docs/Testing_and_Gym.md)
- [Real-world adversarial programme](docs/Real_World_Adversarial_Program.md)
- [Release process](docs/RELEASING.md)

## Privacy and security posture

- no remote telemetry in the current product build;
- no reputation lookup in the interaction-only profile;
- no runtime network lookup in the research reputation profile;
- no password-value storage;
- clipboard content is inspected transiently in the page’s main world only to derive ClickFix metadata, and is not bridged, stored, or transmitted;
- persistent configuration, bounded event history, and prompt outcomes remain in
  `chrome.storage.local`; short-lived pending decisions and per-tab security state
  use `chrome.storage.session` and clear when the browser closes;
- the MessagePort challenge proves possession/liveness, not a hard authenticated identity boundary;
- local history, export, deletion, and retention limitations are documented rather than implied away.

Read [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and the threat model before treating any local build as protection.

## Not currently claimed

NavSentinel does **not** currently claim:

- measured efficacy or a reduction in real-world compromise;
- complete coverage of browser navigation, frames, forms, or extension races;
- a released Chrome Web Store package;
- external security audit or independent validation;
- a reputation service, cloud dashboard, enterprise policy plane, or automatic remediation;
- that a blocked event was necessarily malicious, or that an allowed event was safe.

Those are evidence questions, not marketing defaults.
