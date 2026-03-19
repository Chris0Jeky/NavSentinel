# Threat Model And Cases

## Primary Threats

### 1. Deceptive navigation initiation

The attacker wants a user gesture on one element to produce navigation through a different surface:

- transparent overlays
- giant high-z-index click targets
- retargeted click paths
- synthetic clicks
- delayed popups after a real click
- delayed redirects after a real click

### 2. Deceptive credential submission

The attacker wants the page to look normal enough that a user submits a password before noticing the destination is wrong:

- cross-site form actions
- non-HTTPS password submits
- lookalike or mixed-script domains
- punycode hosts
- IP-literal hosts
- suspicious deep subdomains

## Defensive Strategy

NavSentinel applies local heuristics before or around the browser primitives that attackers commonly exploit:

- content-script capture of click context
- main-world patching of popup and redirect primitives
- service-worker rollback when a bad navigation still commits
- capture-phase interception of password form submits
- explicit user prompts with scoped trust decisions

## Important Cases

### Case: deceptive `_blank` link

- expected outcome: block and prompt unless the gesture is clearly explicit or the destination is already allowlisted

### Case: delayed script popup

- expected outcome: block because the popup is outside the allowed gesture window

### Case: delayed redirect after click

- expected outcome: rollback and offer a deliberate proceed action

### Case: password form on untrusted domain

- expected outcome: prompt with the current domain, destination domain, and risk reasons

### Case: password submit to HTTP

- expected outcome: prompt aggressively or block by policy because credentials would travel over cleartext

### Case: legitimate OAuth or modal flow

- expected outcome: avoid spurious blocking when the visual and behavioral signals look like legitimate UI

## Non-Goals

- defending against a fully compromised browser
- full page-content phishing classification
- remote reputation or anti-abuse intelligence
- complete public-suffix-list coverage

## Residual Risks

- `chrome.storage.local` writes are not transactional, so event logging is best-effort
- registrable-domain logic is heuristic, not PSL-complete
- legitimate but unusual enterprise SSO flows can still prompt until trusted domains are configured
- live-web behavior can still vary in ways the Gym does not model

## Design Constraint

False negatives matter, but false positives also matter because the extension lives in the user's browser loop. That is why the project has:

- separate navigation and credential trust models
- explicit `smart` and `strict` modes
- allow-once and allow-always decisions
- local event history to explain what happened
