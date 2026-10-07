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

### 3. DoubleClickjacking

The attacker abuses a double-click gesture to hijack the second click onto a sensitive button (OAuth consent, MFA confirm, payment) after swapping the page underneath via `window.opener.location`. This bypasses X-Frame-Options, CSP frame-ancestors, and SameSite cookies.

### 4. ClickFix / fake CAPTCHA

The attacker displays a fake CAPTCHA overlay that writes malicious commands to the clipboard and instructs the user to paste them into a Run dialog or terminal. This accounted for 47% of all initial access in 2025.

### 5. Known-bad domain navigation

The attacker uses a domain already present in a curated threat feed. The
selected interaction-only beta profile does not claim or perform this check.
The separate non-release `research-reputation` profile exercises the local,
build-time Bloom-filter mechanism with reserved test domains and no runtime
network calls; a real-feed release profile would require a new owner decision.

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

### Case: DoubleClickjacking via opener.location

- expected outcome: detect the child-window-opens, opener-location-write, child-close, second-click sequence and block the hijacked click with `nrs_double_click_hijack` (+40)

### Case: fake CAPTCHA with clipboard write (ClickFix)

- expected outcome: detect the combination of clipboard write, overlay, and instruction text; alert the user without storing clipboard content

### Case: navigation to a known-bad domain

- interaction-only beta: no reputation lookup or reputation-derived score
- non-release research profile: a reserved-domain Bloom-filter hit adds
  `nrs_known_bad_domain` (+50), so the navigation is blocked or prompted

### Case: legitimate double-click interaction

- expected outcome: no false positive; normal double-click behavior is not flagged

### Case: legitimate CAPTCHA (reCAPTCHA, hCaptcha, Turnstile)

- expected outcome: ClickFix detection is suppressed when known legitimate CAPTCHA providers are present

### Case: legitimate OAuth or modal flow

- expected outcome: avoid spurious blocking when the visual and behavioral signals look like legitimate UI

## Non-Goals

- defending against a fully compromised browser
- full page-content phishing classification
- remote reputation or anti-abuse intelligence

## Residual Risks

### Password presence and shadow-DOM coverage (#200)

The shared credential-page gate is `hasVisiblePasswordField` in
`content/password_field.ts`: a light-DOM password input whose own `disabled`
property is false and whose inline style is neither `display:none` nor `visibility:hidden`. Content fingerprinting,
the SRI gate, and the JS monitor's page-level `credentialFieldsPresent` flag use
this definition. It does not claim full computed-style or ancestor visibility.
`capture_isolated.ts` no longer carries its own password-presence query.

Other predicates retain different boundaries because they answer different
questions; they must not be substituted for that page-level gate:

| Consumer | Current boundary and purpose |
| --- | --- |
| Content analyzer's form-action snapshot | Records structural password descendants, including disabled or inline-hidden inputs, for form-action analysis. It does not assert that those fields are visible or successful submit controls. |
| JS monitor's form-submit signal | Counts password inputs whose own `disabled` property is false: those passing the shared inline-visibility check (including unnamed inputs), or named inline-hidden inputs. This is an exposure heuristic, not a complete successful-form-control check. |
| Credential submit guard | Counts password controls whose own `disabled` property is false, including inline-hidden or unnamed controls, from descendants and `form.elements` (including `form=` associations). This submit boundary intentionally does not apply the passive page-visibility filter. |
| JS monitor's credential-read count | Reports a raw count of light-DOM password inputs after a password-value read, including hidden or disabled fields; it is a count, not the page-presence gate. |
| Mutation monitor | Reports an added or retyped password node without the page-visibility filter. `password_injected` describes a DOM mutation, not a declaration that the whole page passes the credential-page gate. |

The own-property checks do not account for disabled ancestor fieldsets. A
password input inside a disabled `<fieldset>` can still have `input.disabled`
equal to false, so these predicates can count it even when the browser excludes
it from native form data. This documented limitation does not change the
platform's disabled-fieldset or first-legend rules and is not a claim that every
counted field will be submitted.

Document-level password queries do not traverse shadow roots. A password only
inside a shadow tree therefore does not satisfy the shared credential-page gate.
Mutation monitoring separately observes open shadow roots and has tests for
password injection there; this does not establish shadow-form submit protection.
The credential guard and JS monitor listen for submits on `document`, check the
event target, and do not install shadow-root submit listeners. Shadow-form submit
coverage remains unverified. The optional `chrome.dom.openOrClosedShadowRoot`
lookup in mutation monitoring is not proof of closed-shadow credential coverage.
Open/closed shadow credential-page and submit coverage remain known gaps; no
traversal expansion, measured performance result, or owner risk acceptance is
claimed here. JS behavior instrumentation remains disabled in every committed
release profile.

### Other residual risks

- `chrome.storage.local` writes are not transactional, so event logging is best-effort
- registrable-domain logic uses a build-time PSL snapshot; new TLDs require a PSL data rebuild
- the research Bloom filter is a build-time fixture, not live threat coverage;
  any future real feed would become stale between rebuilds
- legitimate but unusual enterprise SSO flows can still prompt until trusted domains are configured
- live-web behavior can still vary in ways the Gym does not model

## Design Constraint

False negatives matter, but false positives also matter because the extension lives in the user's browser loop. That is why the project has:

- separate navigation and credential trust models
- explicit `smart` and `strict` modes
- allow-once and allow-always decisions
- local event history to explain what happened
