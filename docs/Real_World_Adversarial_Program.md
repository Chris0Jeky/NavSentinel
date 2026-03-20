# Real-World Adversarial Program

## Purpose

Turn NavSentinel's current Gym and regression suite into a more realistic security program.

The aim is not just to add harder fixtures. The aim is to simulate dangerous browser situations
that users actually hit in the wild:

- deceptive overlays and clickjacking
- malicious or laundering redirects
- popup abuse hidden inside legitimate-looking UI
- phishing-style credential collection flows
- worker-churn and timing conditions that cause security logic to lose state

This document is the source of truth for the next large scenario expansion.

## Design principles

Every new scenario should follow these rules:

1. It should model a real abuse family, not only a technical trick.
2. It should be deterministic and local by default.
3. It should declare the product expectation clearly:
   - block
   - prompt
   - allow
   - roll back
4. It should identify the cheapest useful test layer:
   - unit
   - Gym regression
   - stress lane
   - live canary
5. It should stay safe:
   - no real credential exfiltration
   - no live phishing domains
   - no remote telemetry

## Why these scenarios

This program is grounded in the kinds of browser abuse called out in official security guidance:

- OWASP WSTG clickjacking testing:
  https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/09-Testing_for_Clickjacking
- OWASP unvalidated redirects and forwards cheat sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html
- Google guidance on deceptive and social-engineering content:
  https://developers.google.com/search/docs/monitor-debug/security/social-engineering
- Chrome extension service-worker lifecycle:
  https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome engineering guidance on testing MV3 service-worker suspension:
  https://developer.chrome.com/blog/eyeos-journey-to-testing-mv3-service%20worker-suspension

## Program shape

## Current landing status

Wave 1 is now underway on top of the operator-surface seed branch.

The first implemented scenarios are:

- RW-01 search-result overlay swap
- RW-03 delayed redirect landing
- RW-04 open-redirect laundering via intermediary page
- RW-06 legit auth popup followed by a blocked second popup
- RW-07 fake re-auth interstitial

### Lane mapping

| Lane | What belongs here |
| --- | --- |
| `smoke` | one obvious blocked case and one obvious legitimate allow case from each scenario family |
| `regression` | deterministic full Gym coverage for the primary user-visible expectation |
| `stress` | repeated bursts, churn, delayed timers, worker restart, and multi-tab sequences |
| `live` | advisory checks against real sites that resemble the scenario family |

### Implementation layers

| Layer | Best use |
| --- | --- |
| Pure unit tests | scoring, token windows, allow-once consumption, worker-policy transitions |
| Gym fixtures | visible user flows and controlled timing |
| Stress fixtures | repeated or long-tail timing failures |
| Live checks | non-blocking sanity only |

## Scenario waves

## Wave 1: Search and landing-page deception

These scenarios are the fastest route to high-value realism because they resemble ad-tech and
malvertising patterns users actually encounter.

| ID | Scenario | Real-world analog | Expected behavior | Primary lane |
| --- | --- | --- | --- | --- |
| RW-01 | Sponsored-result overlay swap | search ad or SEO landing page where the visible result is not the clicked destination | block or prompt new tab / redirect | regression |
| RW-02 | Fake download CTA over legitimate content | free software mirrors, codec lures, fake installer buttons | block deceptive new tab | regression |
| RW-03 | Delayed redirect after a harmless-looking click | "continue", "watch now", or "view file" CTA that redirects late | roll back and offer proceed | regression + rollback |
| RW-04 | Open-redirect laundering via benign host | trusted-looking host forwards to unrelated destination after user click | prompt or block destination transition | regression |
| RW-05 | Multi-step ad chain | first click allowed, second popup or redirect is malicious | allow first, block burst follow-up | stress |

### Wave 1 fixture ideas

- a local search-results page with sponsored cards and a hidden overlay on the first result
- a fake software catalog page with several visually similar download controls
- a "play video" card that delays `location.assign()` by 2 to 4 seconds
- a benign local redirector page that forwards based on `next=` parameters

## Wave 2: Authentication and identity laundering

These scenarios matter because modern phishing often rides on login, consent, and popup patterns
that look legitimate at first glance.

| ID | Scenario | Real-world analog | Expected behavior | Primary lane |
| --- | --- | --- | --- | --- |
| RW-06 | Legit sign-in popup followed by malicious second popup | SSO consent flow with a second surprise window | allow first, block second | regression |
| RW-07 | Fake re-auth interstitial inside a document/productivity flow | "session expired" or "confirm account" inside a doc viewer | prompt on credential submit if untrusted or risky | regression |
| RW-08 | OAuth consent laundering through window reuse | initial allowed popup reused to navigate somewhere unrelated | allow initial popup, inspect later navs | stress |
| RW-09 | Empty-target or named-target popup ambiguity | sites mixing `_blank`, named targets, and `window.open(url)` | allow only truly user-driven legit path | regression |
| RW-10 | Keyboard-only auth launch | Enter/Space activation on focused button or input launches auth popup | allow | regression |

### Wave 2 fixture ideas

- a collaboration tool sign-in page that opens a normal OAuth window and then tries a second one
- a file-sharing page that launches a re-auth form on an untrusted-looking host
- a popup flow that reuses a named window for a later unrelated destination

## Wave 3: Commerce, finance, and wallet abuse

These are high-value because the user cost of a false negative is often immediate money movement.

| ID | Scenario | Real-world analog | Expected behavior | Primary lane |
| --- | --- | --- | --- | --- |
| RW-11 | Fake invoice approval button | "review invoice" or "continue to payment" opens unrelated destination | block deceptive new tab | regression |
| RW-12 | Wallet connect popup burst | crypto wallet connect opens one legit popup and then follow-up abuse | allow first, block later burst | regression + stress |
| RW-13 | Courier tracking login lure | parcel or customs tracking asks for credentials on lookalike host | prompt credential submit | regression |
| RW-14 | Checkout express-pay overlay | page visually implies payment action but hidden element opens another destination | block | regression |
| RW-15 | Bank/security alert redirect | "verify transaction" banner redirects after a timer | roll back and prompt | rollback |

### Wave 3 fixture ideas

- a mock billing dashboard with "review invoice" and "pay now" controls
- a fake wallet connect modal with bursty popup timing
- a shipping-tracker form that posts to a lookalike domain

## Wave 4: Document, media, and support-scam abuse

These cases matter because users are conditioned to trust document viewers, media controls, and
urgent support messaging.

| ID | Scenario | Real-world analog | Expected behavior | Primary lane |
| --- | --- | --- | --- | --- |
| RW-16 | Fake document preview overlay | blurred doc preview with hidden "open" trap | block deceptive click path | regression |
| RW-17 | Media-player overlay hijack | visible play controls with malicious overlay drift | block | regression |
| RW-18 | Browser update / codec warning | fake update dialog that opens installer or support tab | block | regression |
| RW-19 | Tech-support scare page | loud warning modal with repeated popup attempts | block repeated popup bursts | stress |
| RW-20 | Embedded help/chat widget abuse | support/chat launcher that spawns extra tabs or redirects | allow legit widget, block abuse | regression |

### Wave 4 fixture ideas

- a faux PDF preview with one real action and one trap action
- a video player with a visible overlay and a delayed malicious redirect
- a fake browser-health alert that loops popup attempts

## Wave 5: Worker-state, tab-churn, and sequence abuse

These scenarios are less flashy but critical. They are where MV3 state loss and race bugs tend to
hide.

| ID | Scenario | Real-world analog | Expected behavior | Primary lane |
| --- | --- | --- | --- | --- |
| RW-21 | Allow-once followed by immediate second action | attacker spends the allowed gesture and then fires again | block second action | stress |
| RW-22 | Rollback return after worker restart | redirect happens, worker suspends, user returns, offer must still be correct | preserve only valid state | stress |
| RW-23 | Multi-tab simultaneous prompts | several tabs trigger navigation or credential prompts at once | no state leak across tabs | stress |
| RW-24 | Idle-resume popup attempt | long idle, then a late popup or redirect fires after state expiry | block | stress |
| RW-25 | Rapid close/reopen churn | popup or redirect actions survive tab churn incorrectly | stale state must clear | stress |

### Wave 5 fixture ideas

- worker restart harness using idle waits and tab reopen
- repeated delayed timers to cross allow-window boundaries
- multi-tab runner that exercises simultaneous blocked actions

## High-priority first tranche

If starting immediately, the best first 8 scenarios are:

1. RW-01 sponsored-result overlay swap
2. RW-03 delayed redirect after harmless click
3. RW-04 open-redirect laundering via benign host
4. RW-06 legit sign-in popup followed by malicious second popup
5. RW-07 fake re-auth interstitial
6. RW-11 fake invoice approval button
7. RW-16 fake document preview overlay
8. RW-21 allow-once followed by immediate second action

Why these first:

- they cover the strongest real-world abuse families
- they exercise both navigation and credential protection
- they produce visible, reviewable product behavior
- they are implementable in the existing Gym without needing live infrastructure

## Definition of done for the program seed

The seed is complete when:

- the repo has this scenario source-of-truth document
- the active tracker points at it
- each scenario has an expectation and lane
- the first tranche is small enough to batch into reviewable PRs

## Proposed follow-up PR sequence

1. `codex/premium-ui-adversarial-program`
   - premium operator-surface polish
   - seed this scenario program
2. `codex/realworld-wave1-search-and-redirects`
   - RW-01 through RW-05
3. `codex/realworld-wave2-auth-and-identity`
   - RW-06 through RW-10
4. `codex/realworld-wave3-commerce-and-wallets`
   - RW-11 through RW-15
5. `codex/realworld-wave4-doc-media-support`
   - RW-16 through RW-20
6. `codex/realworld-wave5-worker-stress`
   - RW-21 through RW-25

## Notes for implementation

- Keep scenario names descriptive and operator-readable.
- Prefer one visible user story per fixture over overly abstract gadget pages.
- Use branding-neutral local fixtures. The goal is realism of behavior, not imitation of any real
  brand.
- Every scenario should land with at least one explicit "why this should block" or "why this should
  allow" assertion.
