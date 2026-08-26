# Product Strategy

*Established 2026-07-10 from a repository, architecture, roadmap, release, and
market review against `main @ 483ead1`. "NavSentinel" is a working name until
the clearance gate in `ACTION_ITEMS.md` AI-19 is resolved.*

This document owns the product thesis, intended user, portfolio boundaries, and
evidence gates. `Project_Roadmap.md` owns execution order, GitHub issues own
implementation detail, `ACTION_ITEMS.md` owns human-only work, and
`docs/agentic/DECISIONS.md` owns standing decisions. The older Strategic
Outlook, Course Correction, Product Thesis Review, North-Star roadmap, and
Horizon Epics are dated inputs or option portfolios, not parallel priority
queues.

## Verdict

NavSentinel is a **pre-alpha development project**, not a market-ready security
product. Its local-first architecture, deterministic Gym, explainable scoring,
and cross-event browser state are real assets. It has no established adoption
and has not established release integrity, efficacy, quietness, distribution,
retention, or willingness to pay.

The correct path is deliberately narrow:

1. make the smallest honest beta safe to ship;
2. put it in the hands of 10 real users;
3. measure additive protection, interruption, comprehension, and retention;
4. delete or defer anything that does not help those outcomes; and
5. fund one visible differentiator only after the evidence exists.

More detector names, architectural frameworks, or speculative platforms do not
currently make the product more valuable. Trustworthy behavior and evidence do.

## Verified posture on 2026-07-10

| Dimension | Verified state | Product meaning |
|---|---|---|
| Engineering | Typecheck and lint pass; 2,874 unit tests in 95 files pass; smoke E2E passes; main CI is green | Strong engineering foundation, not efficacy evidence |
| Packaging | v0.4.0; no tags, GitHub releases, or CWS release | Nothing installable or supportable has shipped |
| Validation | Last recorded FP result was 0.72% and is stale; corpus methodology/result is invalid; competitive benchmark is unbuilt | Detection and quietness claims remain unproven |
| Distribution | 0 repository stars, forks, and watchers; no external-user evidence | Market validation has not started |
| Work portfolio | 74 open issues, no milestones or assignees; 15 are new Horizon epics | Planning exceeds delivery capacity |
| Human queue | Three old PRs (#273, #356, #399); #356 is red and all are far behind `main` | Human Gate-3 work is not ready to run |
| Release size | Interaction-only build is about 493 KB of a 500 KB aggregate budget and contains no reputation asset | Reputation remains a separately budgeted research path, not beta coverage |

**Current amendment (2026-08-02):** the table above remains the dated
2026-07-10 audit baseline. Since then #356 merged and closed #349, while PR
#509 implemented the interaction-only release profile, closed #321, and passed
AI-25 in real Chrome. Those completed prerequisites are not current blockers;
live execution state belongs in `Project_Roadmap.md` and GitHub.

The old `43/47 complete` score counted artifacts. It did not mean the product
was validated, released, distributed, audited, or useful to a market. Product
readiness must not be represented by an implementation percentage again.

## Market reality and position

The original "catches what browsers cannot see" story has expired. Chrome 137
uses on-device Gemini Nano signals that feed Safe Browsing's final verdict for
users opted into Enhanced Protection. Edge has an on-device scareware blocker,
enabled by default only on qualifying hardware. Opera introduced Paste Protect
for ClickFix-style clipboard attacks in Opera One Early Bird. These are not
proof that NavSentinel has no value; they are proof that local analysis and
named attack coverage are features, not a moat.
Direct Chrome Web Store extensions also advertise
[DoubleClickjacking protection](https://chromewebstore.google.com/detail/doubleclickjacking-protec/ahgaapjkpgndjelgdgmfnkgfimjnapbo)
and a local [ClickFix/OAuth phishing guard](https://chromewebstore.google.com/detail/clickfix-oauth-phishing-g/bkplloeajblikjdffgdepnhicgajfhcd),
while broad incumbents such as
[Malwarebytes Browser Guard](https://chromewebstore.google.com/detail/malwarebytes-browser-guar/ihcjicgdanjaechkgeegckofjjedodee)
and [Bitdefender TrafficLight](https://chromewebstore.google.com/detail/trafficlight/cfnpidifppmenkapgihekkeednfoenal)
already have distribution. Competitive absence is not available as a strategy.

Primary sources:

- [Chrome on-device scam analysis](https://blog.google/security/using-ai-to-stop-tech-support-scams-in/)
- [Microsoft Edge scareware blocker](https://support.microsoft.com/en-US/edge/prevent-online-scams-with-the-scareware-blocker-in-microsoft-edge)
- [Opera Paste Protect](https://blogs.opera.com/news/2026/07/opera-introduces-paste-protect-to-keep-you-safe-from-clipboard-attacks/)

### Initial user

Start with **privacy-conscious technical Chrome users who will install the beta
in a daily profile** and want an inspectable second layer at the moment a page
turns a click, redirect, popup, clipboard write, OAuth callback, or password
submit into a consequential action.

They are the best retention cohort because they can understand the permission
model, report compatibility problems precisely, inspect the open implementation,
and value local processing. Security researchers are a **separate** design-
partner/adversarial cohort; report their findings separately and exclude their
short evaluation installs from daily-use retention and comprehension metrics.

Do not target general consumers, enterprises, caregivers, mobile users, or
agentic browsers yet. Caregiver/recovery workflows may eventually have the
strongest willingness to pay, but they require discovery, support design, and a
separate privacy model before code.

### Product promise

> An open-source, local interaction guard that checks consequential browser
> actions, explains interventions, and complements built-in browser protection
> without uploading browsing activity.

This is intentionally narrower than "browser defense" and does not claim
superiority over Safe Browsing or browser-native protections.

### Defensible advantage

The potential moat is the combination of:

- cross-event correlation across clicks, popups, navigations, clipboard writes,
  credentials, and service-worker state;
- inspectable heuristics, reason codes, and user-owned evidence;
- a reproducible attack/benign corpus and honest comparative methodology;
- measured quietness and warning comprehension; and
- a useful decision journal and recovery path.

The moat is **not** a list of heuristics. Browsers and larger extensions can copy
individual detections. NavSentinel can earn trust by being the most auditable
and candid interaction-protection project.

### Commercial posture

Keep the core extension free and open source through validation. There is no
evidence that users will pay for another general browser-security extension.
Run no-code caregiver/buyer problem and price interviews in parallel as a
separate discovery track; do not infer their demand from technical-user
retention. Do not build or charge for caregiver, recovery, managed support, or
benchmarking until that segment's own evidence exists. Treat each as a separate
product/service boundary, not a reason to expand the extension now.

## Architecture assessment

### Keep and strengthen

- The beta boundary: no runtime network calls, browsing-data upload, or
  telemetry. Any future inbound signed-data channel requires a new explicit
  product, privacy, and release decision; it must never carry browsing state
  outbound.
- MV3 separation between isolated content scripts, MAIN-world interception, and
  service-worker lifecycle state.
- Session-state hydration, bounded local storage, TypeScript strictness, and no
  runtime package dependencies.
- Navigation intent, credential-submit protection, rollback, ClickFix and
  DoubleClickjacking signals, and plain-English explanations.
- Deterministic Gym fixtures, property tests, E2E lanes, release guards, and
  adversarial review.

### Release-integrity findings and dispositions

These findings define the release boundary. Completed dispositions stay here
to preserve the reasoning but must not be presented as open blockers:

1. **Prompt decision authority.** The toast and credential modal expose open
   shadow roots and accept scripted `.click()` activation. Checking
   `event.isTrusted` is necessary but insufficient: a hostile page controls the
   injected host's position/visibility and can redress it under a genuine click.
   For beta, page-injected UI may warn, cancel, or direct the user to the
   extension icon; it must not proceed, allow, trust, or resume. Store a
   tab/destination-bound pending decision with a short TTL and complete every
   protection-lowering action in extension-origin popup/options UI. Closed roots,
   trusted-event checks, and host-tamper tests remain defense in depth.
2. **Retired wrong-tab viewport capture.** RI-02 removes the non-functional
   visual-sim path, including the service-worker viewport capture, public asset,
   scoring hook, and persisted state. It has no production detection value and
   must not be revived without a new opt-in, disclosed, measured design. The
   required Gate-3 still precedes merge and release-blocker closure.
3. **Reputation/package boundary.** AI-9 selected interaction-only. The default
   build now uses an inert reputation adapter, omits the asset and WAR entry,
   and emits a deterministic release-eligible receipt. The 52-byte fixture is
   retained only by an explicit unpacked research profile that package/release
   checks reject. Any future real filter remains a new data-budget,
   cardinality/cadence, licensing, provenance, and release decision.
4. **MAIN-world compatibility (completed).** PR #356 de-hardened the relevant
   prototype replacements, merged as `3bd9e02` on 2026-07-25, and closed #349.
   Keep its wrapper/regression coverage; do not reopen this blocker without a
   current reproduced compatibility failure.
5. **Fake DNR surface.** The checked-in ruleset contains localhost test rules while
   the manifest requests two DNR permissions and options expose an experimental
   blocklist. Remove the toggle, rules, and permissions from the beta. Re-add an
   exact, signed, bounded rule list only when it is a real product feature.
6. **Bridge identity and recovery.** The challenge-response handshake
   demonstrates port possession/liveness; it does not authenticate an
   isolated-world identity against hostile same-page code. Document-start
   ordering is mitigation, not an authorization boundary. Complete #186's
   trusted-context binding and #175's fail-closed recovery before any beta;
   retain an independent external review as a public-launch gate.
7. **Unmeasured global instrumentation.** The JS behavior monitor wraps broad
   page APIs but its compatibility and runtime-overhead work is incomplete.
   Default-disable it in the beta unless headed compatibility and overhead
   measurements pass.
8. **Local data minimization.** Some session and credential/event paths retain
   full URLs, including possible query data. Apply a purpose-specific policy:
   minimize persistent logs/profiles to the least identifying form; retain exact
   session URLs only where target authorization, rollback, or OAuth correctness
   requires them, with tab binding, short TTLs, disclosure, and regression
   tests. The current bounded structural decision record remains local and
   exportable; any future page-content, DOM, or screenshot replay capture is a
   separate sensitive capability that must be explicit and opt-in.

### Architectural rules going forward

- Every capability has an explicit `experimental`, `beta`, or `production`
  state. Incomplete capabilities are off in the default release profile.
- Protection-lowering actions require extension-origin UI, active-tab/
  destination binding, and short-lived pending state. Page-injected UI is not an
  authorization boundary even when its event is trusted.
- Separate executable-code budgets from immutable data/package budgets; never
  raise a cap merely to make CI green.
- Store only the minimum data needed for the stated user job. Bounded decision
  records may be exported by the user; page-content/DOM/screenshot replay data
  is a separate opt-in capability and is treated as sensitive.
- A bloom filter may inform risk scoring; it must not be treated as an
  enumerable DNR source or a direct hard-block oracle.
- Large refactors such as Signal Fabric follow per-signal measurement and
  pruning. Do not abstract 25 unvalidated signals into a grand framework first.

## Beta product profile

The selected unlisted beta is **interaction-only by default**:

- include navigation intent, credential-submit protection, rollback, core
  interaction detections, explanations, and the local decision log;
- retain the merged RI-02 visual-sim excision and absent fake DNR surface; the
  recorded Gate-3 waiver is not a real-Chrome claim;
- default-disable unmeasured JS behavior instrumentation;
- keep fresh installs passive until the user has seen the complete local-data
  disclosure and affirmatively enabled protection;
- ship no reputation runtime, asset, or claim; and
- keep the deterministic reserved-domain fixture only in the explicit
  unpacked-only research profile. A future real profile requires a new owner
  decision after reproducible feed, provenance, cadence, package, and licensing
  gates are specified.

This amends the earlier assumption that a real bloom filter must block any beta.
Reputation is commodity coverage; it should not prevent testing the
interaction-level product. AI-16 ratified the standing default and Chris chose
it explicitly under AI-9 on 2026-08-01.

### Unlisted-beta gates

All must be true:

- page-injected UI cannot proceed, allow, trust, or resume; those actions work
  only through tab/destination-bound extension-origin UI, and host redressing or
  removal can cause denial only—not protection loss;
- the merged #356 MAIN-world compatibility repair retains its regression
  coverage; a new compatibility blocker requires current reproduction;
- visual-sim capture remains absent after #514's recorded Gate-3 waiver (not a
  real-Chrome pass); fake DNR is absent;
- the explicit beta capability profile leaves broad JS behavior instrumentation
  off: fetch/XHR/beacon/password-value prototypes are not wrapped while core
  navigation protection remains active;
- #175/#186 provide trusted bridge identity, liveness/recovery, and a
  fail-closed path when the MAIN/isolated-world channel is unavailable;
- fresh installs remain passive until prominent in-product disclosure and an
  affirmative activation action occur; before installation, the CWS listing
  and Privacy Practices disclose every handled category/use and the actual CWS
  install-consent mapping is evidenced or confirmed by CWS support; onboarding,
  privacy policy, and package disclose the same data categories and uses,
  including local browsing activity, URL/domain data, bounded page text/HTML,
  transient clipboard content, structural signals, interaction/decision
  history, credential/form context, and ephemeral state (never password
  values); #455 owns implementation and verification;
- the public privacy page contains the affirmative Chrome Web Store User Data
  Policy Limited Use declaration;
- the deterministic build receipt is `interaction-only`, package/release checks
  reject every non-release profile, and all store/privacy claims match that artifact;
- full-URL retention is minimized or explicitly justified and disclosed;
- the product name has search, domain, CWS, and professional legal/trademark
  clearance appropriate to the intended launch;
- fresh-install, onboarding, popup, options, allow-once, credential, and normal
  browsing checks pass in real Chrome;
- screenshots/assets, package checks, and an unlisted CWS submission are ready;
- GitHub private vulnerability reporting is enabled and `SECURITY.md` points to
  the verified private advisory route; and
- every remaining known limitation has an owner and a dated decision.

The exact name `NavSentinel` is already used for a publicly announced,
coming-soon [TruNav GNSS anti-spoofing receiver](https://trunav.net/),
publicized by the [US Department of Transportation](https://www.transportation.gov/arpa-i/ideas-challenge/finalists/trunav-narrative).
This is not a legal conclusion, but it makes clearance or an early rename a
release gate; rebranding is cheapest before a store listing exists.

### Public-launch gates

In addition to beta gates:

- obtain an independent external security review of the exact beta commit and
  packaged artifact, then resolve every finding or explicitly accept the
  residual risk;
- publish reproducible benign and attack results with sample sizes, misses, and
  limitations;
- show additive wins against current Chrome and relevant Chrome extensions;
  keep Edge and Opera as contextual research unless they become supported
  product targets;
- in the daily-use cohort, retain at least 7 of 10 activated installs at day 14
  and 6 of 10 at day 30, with a reason recorded for every disable/uninstall;
- establish a support, vulnerability-response, and rollback path; and
- remove or substantiate every comparative and efficacy claim.

## Evidence model

Green CI proves regression discipline, not security efficacy. Use separate
evidence lanes:

| Question | Evidence | Initial gate |
|---|---|---|
| Does it add protection? | Pre-register 24 attack scenarios, comparator versions/configurations, expected pre-harm outcome, and core Gym non-regression set | At least 3 additive pre-harm wins across 2 attack families; zero core-protection regressions; publish every miss |
| Is it quiet enough? | Pre-register 20 named benign journeys plus a descriptive top-1000 run | Zero unexplained block/rollback in named journeys; report prompt/block rates and confidence intervals for the top-1000, not a pass/fail claim |
| Is a numeric FP claim supportable? | Larger sample with committed methodology and confidence interval | Do not claim `<0.1%` from 1,000 samples; zero in 1,000 still has an approximate 95% upper bound near 0.3% |
| Do warnings work? | Ten uncoached tasks in the daily-use cohort | At least 8 of 10 identify the risk and safe next action; report the count, not a population claim |
| Will people keep it? | Daily-use cohort with manual day-14/day-30 check-ins | Of 10 activated installs, at least 7 remain enabled at D14 and 6 at D30; reason for every disable/uninstall |
| Is interruption tolerable? | Weekly check-in plus voluntary redacted export | Cohort median no more than 1 unexpected intervention/user-week; investigate every user with more than 2 |
| Can permissions earn trust? | Fifteen invitations with install-warning/onboarding observation | At least 10 activated installs; record a reason for every non-install or abandoned onboarding |
| Does it preserve ordinary site behavior and performance? | Representative headed journeys with page-error/breakage capture plus startup, click, submit, and navigation latency/CPU measurements | Zero unexplained functional breakages in the declared beta journey set; publish fixed latency/CPU budgets before enabling broad instrumentation |

Because telemetry is prohibited, early evidence comes from CWS install state,
opt-in check-ins, structured interviews, voluntary redacted exports, issue/store
feedback, and manually confirmed cohort retention. Do not list weekly active
users as a KPI until an allowed collection mechanism exists.

For this experiment, **activated** means installed in the participant's daily
Chrome profile, onboarding completed, and both Smart navigation and credential
modes still enabled after 24 hours. "Enabled at D14/D30" uses the same profile
and modes. These small-number thresholds are product-discovery go/no-go gates,
not statistically generalizable validation.

## Critical review of planned ideas

| Idea | Disposition | Reason / activation evidence |
|---|---|---|
| Explanations + Decision Journal + recovery guidance | **Next** | Turns technical detection into a visible user job; tune from comprehension and override evidence |
| Current-browser proving ground | **Next** | Can establish additive value and become a credibility/distribution asset; must publish misses and data flow |
| Real bloom reputation | **Redesign/optional** | Commodity coverage; current cardinality, provenance, cadence, licensing, and package budgets conflict |
| Dynamic DNR from the bloom set | **Reject as designed** | A bloom filter is probabilistic and non-enumerable; DNR needs a separate exact, prioritized list within [Chrome rule limits](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) |
| Visual similarity / logo embeddings | **Current path removed; defer new design** | The retired path never matched and created privacy/correctness risk; revisit only with opt-in, demand, model/update budget, and measured gain |
| JS behavior instrumentation | **Beta-off** | Broad global API wrapping has unfinished runtime/compatibility evidence and repeats known site-breakage risk |
| Signal Fabric / calibrated judgment | **Defer** | First log typed signal contributions, measure marginal value, and delete weak signals; abstraction before evidence ossifies noise |
| Guardian/caregiver circle | **Discovery only; separate product boundary** | Potentially valuable, but signed bundles/account graphs create sensitive relationship data and setup/support burden; require 10–12 paired interviews and an unaided setup test |
| Proof capsules / DOM snapshots | **Reject by default** | Raw DOM/replay capture creates disproportionate privacy, secret, storage, and export risk; a minimal redacted evidence schema must prove insufficient first |
| Remote/community rule packs | **Defer/redesign** | Hashed domains are dictionary-reversible; remote packs require governance, signatures, rollback, privacy, and CWS remote-code review |
| Native companion, mobile, or agent conduct layer | **Separate future products** | Different permissions, threat models, distribution, and support; no activation before desktop retention |
| Firefox | **Defer** | No complete build/runtime parity or demonstrated user demand; maintain clean seams, not an active port |
| Permanent adaptive/self-tuning protection | **Constrain** | User allows can encode habituation or attacker influence; adjustments must be bounded, inspectable, reversible, and evaluated for protection loss |

Horizon-specific rejection gates:

- EP-03/EP-04 must not send uncertain or over-budget threats to journal-only
  while claiming no true positive is dropped. Any abstention path must preserve a
  safe intervention or explicitly accept the protection loss.
- EP-07's account/credential relationship graph is a confidentiality problem;
  a hash chain provides integrity, not secrecy.
- EP-12 DOM capsules and EP-13 remote rule packs are incompatible with the
  current privacy/release posture until redesigned.
- EP-14 creates a permanent maintenance program before retention; EP-15 is a
  separate product, not an extension epic.

## Portfolio

### Now: release integrity and first users

- Fix prompt action authenticity.
- Recreate or defer closed #273's intent; keep closed #399 out of the beta
  blocker set until measurement justifies it. #356 is complete and remains
  regression coverage, not an open work item.
- Keep the merged RI-02 excision, fake-DNR removal, and data minimization/reset
  boundaries accurate; preserve the selected interaction-only beta profile.
- Complete #175/#186 bridge identity/recovery and #455 pre-collection
  disclosure/consent.
- Clear the name, claims, privacy, assets, fresh-install, and real-Chrome gates.
- Submit an unlisted beta and recruit the first cohort.

### Next: evidence and one visible benefit

- Finish corpus-v2 methodology (#417) and rerun it (#416/#426).
- Build a current-browser comparative benchmark (#418).
- Turn the local event log into a clear Decision Journal with recovery guidance.
- Improve explanations based on observed comprehension and overrides.

### Later, only with activation evidence

- Caregiver/recovery workflow: after 10-12 discovery interviews and an unaided
  setup test.
- Exact-list DNR and any signed reputation refresh: after feed operations,
  licensing, rollback, and rule-budget design, plus a renewed explicit decision
  authorizing the inbound update channel.
- Firefox: after a real second-browser demand signal and a dedicated build/test
  path.
- On-device ML/logo embeddings: after heuristic measurements plateau and the
  size/update model is solved.
- Enterprise, native companion, community intelligence, agentic browser, and
  mobile: separate products or post-retention bets.

### Stop

- No new Horizon or North-Star implementation before beta evidence.
- No "only extension," "no competitor," or "browsers cannot see this" claims.
- No security theater: placeholders, never-firing paths, or experimental toggles
  in the default release.
- No more feature/epic issue seeding until the active queue is milestone-categorized,
  duplicate Horizon trackers are closed, and the WIP cap is below three.
- No feature work whose success metric, data source, owner, and kill condition
  are undefined.

Mutable action IDs, issue dispositions, owners, and the 90-day sequence live in
the execution source: [`Project_Roadmap.md`](Project_Roadmap.md). Do not copy
them back into this strategy document.
