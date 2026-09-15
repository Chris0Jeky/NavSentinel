# NavSentinel product strategy

**Status:** pre-alpha, development and controlled dogfooding only  
**Last reconciled:** 15 September 2026  
**Name:** `NavSentinel` remains a working name pending clearance

## Strategic verdict

NavSentinel should become a narrow, honest browser interaction guard before it becomes anything broader.

The current repository contains substantial protection logic, operator surfaces, deterministic Gym coverage, adversarial fixtures, release tooling, and a growing evidence architecture. That is not the same as a validated product. The correct path remains:

1. close the authority and release-integrity blockers;
2. ship one understandable interaction-only beta;
3. recruit a small group of real users;
4. measure additive protection, interruption, comprehension, recovery, and retention;
5. fix the evidence-backed problems before adding reputation services, enterprise controls, cloud dashboards, or a commercial layer.

## Product promise

> An open-source, local interaction guard that checks consequential browser actions, explains interventions, and complements built-in browser protection without uploading browsing activity.

This promise deliberately does not say “blocks phishing,” “stops malware,” or “secures Chrome.” Those claims require real-world comparative evidence that does not yet exist.

## User and problem

The initial user is a technically comfortable person who wants another check at the moment a web page turns an interaction into a consequential side effect:

- a click opens or redirects somewhere unexpected;
- a foreground layer captures or retargets a gesture;
- a form sends credentials to a risky destination;
- a second click lands on a sensitive control after the page changes;
- a fake CAPTCHA writes a command and asks the user to paste it;
- a script attempts a popup, submission, or cross-domain transition outside the visible intent.

Built-in browser protections remain essential. NavSentinel’s opportunity is the local, cross-event interaction context around those moments: what the user touched, what changed, where the action was going, and whether the page’s effective destination or geometry shifted before commitment.

## What the product is

NavSentinel has two cooperating planes with different authority.

### Guard plane

- MV3 extension and local decision engine;
- navigation, overlay, form, credential, DoubleClickjacking, and ClickFix checks;
- popup/options controls, trusted domains, navigation allowlists, bounded local history, and recovery;
- interaction-only release profile;
- extension-origin review and authorization surfaces.

The Guard may intervene within its declared local policy. It must not silently upload browsing data or delegate a protection-lowering decision to page-controlled UI.

### Evidence plane

- deterministic Gym attack and benign contrasts;
- real-world adversarial campaign definitions;
- recorded scenes, DOM mutations, geometry, timing, decisions, and outcome receipts;
- replay and comparison tools;
- build-profile and release-input attestations;
- measured quietness, interruption, and user-comprehension evidence.

The Evidence plane is read/record/compare infrastructure. It must not gain implicit authority to click, submit, trust, allow, resume, change policy, install, package, publish, or release. Any such capability requires a separate reviewed contract.

## Product moat

The defensible direction is not a secret classifier or a longer blocklist. It is the combination of:

1. **Cross-event correlation** — connect gesture, geometry, mutation, destination, form state, and timing rather than judging one URL in isolation.
2. **Inspectable decisions** — stable reason codes, evidence summaries, effective destinations, and explicit uncertainty.
3. **Strict authority binding** — protection-lowering decisions belong to extension-origin UI and bind to the tab, document, destination, element/form state, and intended one-use action.
4. **Reproducible attack/benign corpus** — every new protection should have a paired legitimacy contrast and a versioned campaign receipt.
5. **Measured quietness** — false interruption and confusing prompts are first-class product failures, not acceptable collateral.
6. **User-owned evidence** — bounded local history, export, deletion, and recovery without a mandatory cloud account.
7. **Release integrity** — exact source/profile/input/build/publication relationships rather than “CI passed” as a substitute for artifact identity.

## Current product boundary

### Implemented on `main`

- navigation and credential guards;
- overlay detection/suppression and grouped recovery;
- `window.open` and form interception within the documented browser limits;
- selected service-worker rollback behavior;
- DoubleClickjacking and ClickFix detection;
- popup/options/trust/allowlist controls;
- bounded local event history and configuration import/export;
- deterministic interaction-only versus research-profile receipts;
- substantial unit, Playwright, Gym, showcase, and real-world fixture coverage.

### Active development themes

- effective form destinations, submitter overrides, child-frame authorization, mutation timing, and one-use authority;
- document/element lifetime and competing-decision serialization;
- evidence scenes, campaign replay, reason/proof receipts, and bounded Observatory views;
- output/export privacy and intellectual-property boundaries;
- raw release input, generated-byte, source, and package attestation;
- deterministic fixture delivery and test reproducibility.

Open branches and PRs remain proposed changes until merged and proven. Their existence does not change the current release claim.

### Not implemented or not proven

- public beta distribution or Chrome Web Store release;
- independent efficacy study or external security audit;
- a production reputation service;
- complete authority closure across every browser race and frame/form case;
- public telemetry, cloud dashboard, remote policy management, or automatic remediation;
- evidence that real users understand the prompts or keep the extension enabled;
- evidence that additive protection outweighs interruption on the open web.

## Evidence ladder

Public wording should name the strongest evidence actually available:

| Level | Meaning |
| --- | --- |
| E0 — designed | documented architecture, threat, or acceptance contract only |
| E1 — deterministic | unit/Gym fixture proves a bounded behavior in controlled state |
| E2 — browser replay | real browser reproduces attack and benign contrast with recorded decision evidence |
| E3 — dogfood observation | bounded live observation with exact build, page conditions, and known limitations |
| E4 — small beta | real-user task evidence covering protection, interruption, comprehension, and retention |
| E5 — independent | external audit, reproduction, or comparative study |

No claim should inherit a higher level because a neighboring feature reached it. A package receipt proves package identity, not efficacy. A blocked Gym attack proves that fixture, not a malware category. A dogfood observation is not a representative user study.

## Pre-beta gates

### Gate 1 — authority integrity

- all protection-lowering actions originate from extension-controlled UI;
- decisions bind to intended tab, document, effective destination, and reviewed element/form state;
- stale, replayed, mutated, competing, or reused authority fails closed;
- frame and navigation boundaries have explicit semantics and tests;
- recovery does not synthesize or replay the original user action onto newly exposed content.

### Gate 2 — release integrity

- interaction-only profile is the only release-eligible profile;
- raw inputs, generated assets, source commit, dependency state, package bytes, and publication receipt are linked;
- no research fixture, secret, local path, unreviewed generated byte, or ambiguous build input enters the release;
- package/install/update/rollback instructions are reproducible;
- known limitations and unsupported browser behavior are carried into release notes.

### Gate 3 — protection and legitimacy evidence

- every headline protection has deterministic attack and benign contrasts;
- the same exact build is used for the evidence and release candidate;
- campaign/replay evidence states what was measured and what was not;
- known open-web gaps, false positives, and browser limitations are visible;
- no evidence path can silently mutate policy or authorize an action.

### Gate 4 — privacy and recovery

- local storage inventory, retention, export, deletion, and recovery are complete enough for beta users;
- exported artifacts cannot leak secrets, private page content, or unreviewed intellectual property;
- no remote telemetry or reputation lookup appears in the default product;
- uninstall/reinstall, import, configuration corruption, and rollback have documented outcomes.

### Gate 5 — beta usability

- installation and update are understandable without repository archaeology;
- prompts explain destination, reason, consequence, and safe alternatives;
- quietness is measured against normal browsing tasks;
- users can report an interruption, reverse a local decision, and inspect recent evidence;
- accessibility, keyboard behavior, and narrow surfaces are tested.

## Small-beta plan

The first beta should be deliberately small—roughly ten participants is enough to expose gross usability and noise problems without implying statistical validation.

### Questions to answer

- Did NavSentinel catch anything the browser/user would otherwise have missed?
- How often did it interrupt legitimate work?
- Did users understand what changed and what the prompt was asking?
- Could they recover safely without disabling the product?
- Which protections produced value, confusion, or no observed benefit?
- Did participants keep it enabled after the study window?

### Measures

- tasks or sessions observed, with an explicit denominator;
- prompts/blocks by protection and reason;
- user classification of each interruption;
- time to understand and recover;
- false-interruption and abandonment rate;
- successful safe alternative or decision reversal;
- retention at the end of the bounded study;
- qualitative confusion and trust notes.

Blocked-event count alone is not a success metric. The study must retain unknown and disputed cases rather than forcing them into malicious/benign labels.

## Distribution and adoption

Initial distribution should remain source/unpacked or a clearly labelled development package until release gates close. A later public beta should have:

- one supported Chromium baseline and explicit unsupported versions;
- immutable or checksum-verifiable package identity;
- simple install/update/rollback instructions;
- a concise threat/limitations page;
- an obvious feedback and evidence-export path;
- no account requirement.

Chrome Web Store publication is a separate decision with policy, disclosure, signing, update, and naming consequences. It should not be inferred from a working package.

## Business direction

Commercialization is not the current bottleneck. The product first needs evidence that the narrow local guard is useful and tolerably quiet.

Possible later models include paid support, managed policy/evidence services, organization-specific deployment, or a hosted reputation supplement. Each would introduce new privacy, availability, threat, and trust boundaries. None should be built merely because the local extension has a large backlog.

The open-source local guard and reproducible evidence corpus are the strongest near-term credibility assets.

## Non-goals for the current phase

- replacing Google Safe Browsing, endpoint security, password managers, or user judgment;
- guaranteeing that an allowed action is safe or a blocked action is malicious;
- broad content filtering or ad blocking;
- collecting browsing history for a central dashboard;
- remote automatic response or policy changes;
- a generic browser automation or attack framework;
- enterprise multi-tenancy before the single-user evidence loop works;
- treating benchmark quantity, issue count, or model sophistication as product validation.

## Decision rule

When choosing work, prefer the smallest slice that improves one of these outcomes:

1. a consequential action is bound to the state the user actually reviewed;
2. an attack and its benign contrast become reproducible;
3. a decision becomes easier to understand or reverse;
4. a release claim becomes tied to exact artifact evidence;
5. real-user protection, quietness, comprehension, or recovery becomes measurable.

Everything else is secondary until the honest-beta gates are met.
