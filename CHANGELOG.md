# Changelog

All notable changes to NavSentinel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

v0.5.0 is a GitHub pre-release for the owner and testers. The Chrome Web Store beta has not been submitted; it keeps its own gates and will ship later as a 0.5.x release. The packaged build is the `interaction-only` release profile: it contains no URL-reputation runtime or data, and JavaScript-behaviour instrumentation is off. The owner's manual browser checks for this release (ACTION_ITEMS.md, AI-47) are still open; the automated branded-Chrome and acceptance lanes are supporting evidence, not a substitute. The extension still makes no runtime network calls. This section covers the pull requests merged to `main` since v0.4.0 (2026-05-03) plus the fixes landed in the v0.5.0 release push, and replaces the stale `[Unreleased]` notes.

### Added

- **Protection Center.** A new extension page, linked from the popup and Options, lists locally recorded events with category filters and plain-language risk explanations, in Forest, Paper and Midnight themes (#640).
- **Evidence export with preview.** Protection Center shows every filtered event before saving a local evidence file. Cancel or Escape discards the snapshot; Download writes exactly the bytes you reviewed, even if the journal changes in the meantime. Files are capped at 8 MiB (exactly 8 MiB is accepted, one byte more is refused) (#641, #696).
- **Held new-tab navigations are approved from the extension popup.** When a suspicious `_blank` HTTP(S) navigation is held, "Proceed once" is offered in the NavSentinel popup instead of in page-injected UI, and the page warning offers Dismiss only. Before opening the tab, the service worker re-checks the tab, window, frame, document, destination hash and expiry, and it fails closed on expiry, replay or a changed context (#466, #608).
- **Opt-in automatic overlay cleanup** (off by default). When enabled, high-severity deceptive foreground overlays in the top document and ordinary child frames are hidden under one Undo group. Accessible dialogs, low z-index layers and small benign controls are left alone, and nothing is hidden while Navigation is Off (#557). Options and the popup show the cleanup status as Disabled, Active, or Paused · Navigation Off (#643).
- **Options auto-save**, on by default. Validated edits save automatically. Turning auto-save off is saved at once and shows an "Unsaved changes" reminder with Save and Discard (#643).
- **Settings conflict choice.** When another Options window changed the same setting from the same starting value, you choose "Keep my edits" or "Use external values"; unrelated unsaved edits are kept (#643, #658).
- **Clear all behavioural data.** One reset clears the event log, prompt outcomes, adaptive scores and domain profiles together, so no derived data outlives its source (#535).
- **Block-notice count pill.** After three block notices within 8 seconds on one page, further notices collapse into a single "NavSentinel blocked N navigations" pill instead of one card each (#353).
- **Plain-English risk explanations** in toasts instead of raw scores, with explanation text for every active reason code (#64, #92, #151, #344).
- **Toolbar badge risk indicator:** green, yellow or red by page risk, gray when protection is off, with the page's block count (#65).
- **Adaptive per-domain thresholds.** Your own allow and block decisions on a domain move its block threshold by at most 15 points (effective threshold 30-100). Allows at high scores count less, and small or indecisive histories do not move it (#66, #212, #276).
- **First-install onboarding page** (#73).
- **Visual redesign** of every UI surface with shared design tokens and an SVG icon set: a HUD-style popup with a risk gauge and signal chips, an Options dashboard with sidebar navigation and segmented mode controls, and a restyled credential prompt, toasts and onboarding page (direct commits, 2026-05-16).
- **Accessibility:** keyboard navigation and ARIA roles for segmented controls and toggles, popup landmarks and live regions, hidden decorative icons, a focus trap in the credential prompt, and popup chip and trust-pill colours checked against WCAG AA contrast (#80, #132, #133, #134, #135, #183, #525, #582, #583).
- **New Navigation Risk Score (NRS) signals:** navigation-pattern anomalies (#78), weak page Content-Security-Policy (#71), Subresource Integrity coverage on credential pages (none +8, under 50% +5, 50-99% neutral, full -3) (#68, #587), and per-domain behavioural profiles (#69).
- **Top-sites trust tier.** A filtered, build-time list of popular sites reduces false positives. A lone low-risk heuristic toward a listed destination no longer triggers a Smart-mode new-tab prompt. When the score comes only from click-layout (CDS) reasons and benign navigation structure, the block threshold for a listed destination is 20 points higher; that value is a starting point that has not yet been measured against false-positive and attack sets. Known-bad and attack-grade signals keep the full threshold (#257, #354).
- **Fewer Smart-mode prompts on benign new-tab links:** same-host or same-organisation links with a low click-deception score, known identity-provider OAuth URLs and listed payment processors open without a prompt. This applies only after a trusted pointerdown and click, with a below-threshold score and only benign factors (#255).
- **Navigation containers:** clicks inside `nav` or `role=navigation` containers no longer raise the intent-mismatch signal when the clicked control is inside the container (#256).
- **Silent decisions are journaled locally.** Allowed navigations (`nav_silent_allow`) and evaluated credential forms (`cred_form_evaluated`) are now recorded; this changes no decision (#253). Top-frame links with `target="_top"` or `_parent` are now recorded as same-tab navigations (#840).
- **Prompt outcomes record the score components** that drove each decision, so decisions can be re-scored offline (#249).
- **Import reports truncation.** Options now says how many event-log entries the 5,000-entry import cap dropped (#542).
- **Opaque-scheme iframes.** The DOM mutation monitor now flags injected `data:`, `blob:` and `javascript:` iframes (#190).

### Changed

- **The release build is `interaction-only`.** It is the default and only packageable profile, with no reputation runtime, asset, manifest entry or user-facing claim. A deterministic `research-reputation` build that uses a reserved-domain test fixture (not real threat data) remains for unpacked local experiments; packaging and release reject it, and the artifact verifier rejects reputation or superiority wording in shipped HTML (#509, #430).
- **JavaScript-behaviour instrumentation is off in every build.** The `fetch`, `XMLHttpRequest`, `sendBeacon` and password-value monitors (#101, #104, #105, #107, #108, #402, #506) are now a declared release-profile capability set to false in all profiles, including the release build (#532).
- **An active user gesture is shown as risk evidence, not reassurance.** The popup and toasts present it as a warning, and its explanation now describes the gesture state when navigation was attempted. Its score contribution is unchanged (#716, #719). Popup and toasts share one risk-reducing-signal rule (#541).
- **Popup and Options write settings through one service-worker queue.** Options saves only the fields you changed and picks up popup changes live (#589). Imports, manual saves and auto-save run in order: auto-save pauses during an import, overlapping writes are refused until the page reconciles, and unsaved edits are recovered after an ambiguous failure (#699).
- **Log limit** accepts any whole number from 50 to 5,000, matching what import accepts (#655).
- **Licence changed to GPL-3.0-only.** The former MIT grant is kept in `LICENSES/MIT.txt`, and release packages include the licence text (#553, #554, #760).
- **Size budgets.** The aggregate size guard rose from 500 KB to 540 KB (#876), and the popup script budget from 10.5 KB to 11.5 KB; the popup loads only when opened (#885). The budgets for scripts injected into pages are unchanged. The storage chunk shrank by about 49.6 KB through a compacted public-suffix trie (#590), and CI enforces the budgets on every run (#83, #99, #120).
- **Release packaging** now writes deterministic, link-safe ZIP archives (#746). Release tooling checks the exact committed inputs before tagging and runs with a sanitized environment (#67, #516, #712, #728, #731, #765).
- **Toolchain:** Vite 8, Vitest 4 and CRXJS 2.7, an ESLint flat config, and dev-dependency upgrades that cleared the reported advisories. None of these packages ship in the extension (#94, #114, #116, #118, #463, #502, #573, #660, #667, #673).
- **Code cleanup:** no explicit `any` in source or tests, dead exports, duplicate handlers and stale TODOs removed, and shared helpers extracted (#93, #100, #102, #117, #119, #128, #130, #131, #170, #171, #804, #811).
- **Firefox groundwork:** a `browser.*` compatibility shim and `manifest.firefox.json` were added (#173), but no Firefox build exists yet. Chrome remains the only supported browser.
- **Tests:** broader unit and property-based coverage across scoring, storage, domain handling, analyzers and UI models (#72, #84, #87, #103, #121, #122, #123, #124, #125, #126, #136, #137, #138, #139, #140, #141, #142, #143, #144, #147, #148, #149, #150, #152, #155, #159, #160, #161, #162, #163, #164, #278, #519, #550, #551, #749, #751, #752, #754).
- **Browser test lanes:** the Phase-2 end-to-end lane was repaired and is selected by default again, mutation-observer and bridge-ordering tests were made deterministic, headed lanes run serially, and branded-Chrome acceptance lanes were added (#112, #503, #504, #524, #543, #544, #574, #576, #602, #603, #607, #611, #623, #625, #682, #697, #730, #733, #734, #735, #743, #845, #846, #861, #871, #881).
- **Local test ranges (not shipped):** the Gym, Proving Ground and adversarial programme now use loopback-only destinations and typed harm receipts, the phishing corpus scores "protected" separately from "fired", and a maintainer-run branded-Chrome runner was added (#70, #251, #435, #597, #598, #605, #610, #613, #614, #615, #616, #617, #618, #619, #620, #621, #624, #626, #627, #628, #629, #630, #631, #632, #633, #634, #635, #654, #663, #666, #669, #681, #683, #687, #714).
- **Developer tools outside the extension (not shipped):** the Evidence Observatory and the Vision Lab with its native shell (#645, #651, #656, #664, #703, #704, #705, #706, #708, #710, #724, #725, #726, #727, #729, #744).
- **CI:** workflows run on Node 24 actions, use read-only tokens by default, pin actions to commits, run on stacked pull requests, bound job durations, and fail on auxiliary-lane flakes (#512, #538, #670, #674, #675, #676, #677, #678, #679, #732, #747).
- **Build diagnostics:** each build prints a reminder to reload the unpacked extension, and stale-loader failures in tests now explain themselves (#571).
- **Documentation** now describes only shipped and measured behaviour: a claims-honesty pass, a verified-claims policy, and a repositioning around authority and replayable evidence (#429, #433, #527, #713). A Chrome Web Store listing draft and a security audit scope were added (#81, #82).

### Fixed

- **Site breakage from MAIN-world hooks.** Strict-mode single-page-app routers (for example claude.ai, which showed a grey screen) failed because NavSentinel installed `pushState`/`replaceState` as read-only. Those hooks and the form-submit, Location and `window.open` hooks are now writable and configurable, with the page's wrapper chaining to NavSentinel's (#352, #356).
- **Unresponsive toast buttons.** Dismiss, Allow once and Undo could be visible but do nothing. Toasts now take input through an isolated-world input fence and render in the top layer (#600).
- **NavSentinel's own credential prompt** was flagged as a suspicious overlay (a spurious toast at default settings) and could be hidden by overlay cleanup. It is now registered as extension-owned and shown in the browser's top layer, so page layers cannot cover its buttons (#825).
- **Overlay cleanup recovery.** The "safety limit" toast shown after 128 hidden overlays now offers Undo (#768), and one hostile element no longer stops the rest of a batch from being hidden or restored (#769).
- **Popup "Current page" gauge.** It could show another site's risk; it is now scoped to the active site (#214), attributes child-frame alerts to the top-level page (#586), validates and canonicalises stored page sites with a fallback to the legacy site field (#644, #657), has a distinct state for threats that carry no score (#533), and uses only evidence from the last ten minutes for the exact active host. Negative, non-finite and implausible scores are ignored, and scores above 100 are shown as 100 (#715).
- **Stale redirect-chain scoring.** Chain context is cleared after typed, bookmark, address-bar, Back and Forward navigations and when a page is restored from the back/forward cache, and it is primed earlier at page start (#609, #520). Allowlisted hosts are fully exempt from chain scoring (#294).
- **Browser Back and Forward** are no longer rolled back: Chrome's `forward_back` commits count as user intent, while later page-initiated redirects are still checked (#570).
- **Rollback and forward-offer reliability:** fixes for double sends and re-queued offers (#332), send races (#359, #379), a forward offer lost on a navigation error (#341), a delivered offer that was never cleared (#521), and a suppress window left open after an unrelated navigation (#326). A rollback that arrives after the tab has already moved on is now ignored instead of navigating twice (#839).
- **OAuth flow tracking:** a commit is treated as the callback only when it carries an OAuth response indicator and the code or error is corroborated. Callbacks are recognised even when the callback URL does not look like an OAuth endpoint, a second authorization URL no longer wipes the flow, and completed flows are cleaned up (#220, #268, #333, #369, #531).
- **Content-analysis false positives:** ordinary relative form paths are no longer called base64-encoded (#383), a CSP nonce or hash is no longer scored as permissive `unsafe-inline` (#388), duplicated CSP directives are read first-wins as browsers enforce them (#781), and image names such as `purchase-logo.png` or `pineapple.png` no longer count as a brand match for common-word brands (#838).
- **Domain detection gaps:** pure look-alike-character brand spoofs and IPv6-literal hosts are now detected (#208). Dead or duplicate brand aliases were removed, and trie walks and trusted lists are prototype-safe and null-safe (#319, #802).
- **Password fields hidden inline** no longer trigger the credential-page SRI gate, and field visibility is checked with the browser's CSS engine (#195, #197).
- **Service-worker restarts:** message and navigation handlers wait for restored session state (#265, #280, #361). The default mode is re-read on every worker start (#316, #370), child-window tracking before restore is deferred (#191), and restored session data is shape-checked (#345, #365, #392). A missing response for an undefined tab id was also fixed (#158).
- **Toolbar badge races** that could leave a stale or wrong badge, or reject when tab queries fail (#271, #283, #334, #396, #798).
- **Lost updates in local storage:** domain profiles, prompt outcomes, settings and trusted domains are now written in order (#180, #182, #313, #340). Imports commit their core sections atomically and apply the event-log cap (#154, #270, #284). A reset now persists before any clear or replace (#513), and failed appends retry instead of vanishing silently (#153, #343).
- **Options reliability:** concurrent Save clicks are guarded (#194), and failures are reported when the worker is unreachable (#202). Stats count plain "allow" outcomes, and empty numeric fields fall back safely (#368). A successful import is reported as success even if the refresh afterwards fails (#828).
- **Messaging failures fail closed.** If creating a pending new-tab prompt fails, navigation stays blocked and a toast is still attempted. Failed popup mode or auto-dismiss saves re-sync the popup from stored state instead of showing unsaved values (#850).
- **Always-allow suggestions** skip pairs that are already allowlisted, count earlier "always allow" choices, and use a bounded cooldown map (#314, #381).
- **Allowlist migration** handles falsy and truthy-invalid legacy values and prototype-named site keys (#317, #808).
- **Corrupt or non-finite stored values** no longer skew scoring: adaptive thresholds, navigation-anomaly counters, domain-profile counters, redirector hop counts and element-context fields are validated on read (#372, #375, #793, #795, #800, #833, #835).
- **Navigation-anomaly and profile bookkeeping:** the anomaly score no longer lags one navigation behind or records a phantom burst after a storage failure, and stale domain profiles can no longer escape eviction (#189, #293, #296).
- **Hostile-page performance bounds:** capped regexes (ReDoS), title, image-signal, form, meta, script-text and form-action scans on the credential and snapshot paths, plus a capped blocked-action list with deduplicated pushState alerts (#193, #376, #403, #406, #407, #522, #789).
- **Mutation monitor:** nested shadow observers disconnect when an ancestor is removed, removed-node cleanup and shadow-root discovery continue past the alert cap, and form-action and iframe URLs resolve against the document base URL (#405, #412, #526, #844).
- **Build-time data fails closed** on empty or malformed public-suffix, bloom-filter or top-sites inputs, and the generated outputs are deterministic and line-ending-safe (#261, #329, #330, #331, #335, #336, #337, #338, #505).
- **Reputation code (research build only):** degenerate or oversized filter parameters are rejected (#291, #318, #806, #862).
- **Clicking a link's own child** (text in a `<span>`, an `<h3>` title or an icon) is scored as a click on the link. It no longer adds an intent-mismatch score that held ordinary cross-site links in Smart mode. See-through children that hide the link keep their concealment signals (#882).
- **Protection modes are validated on every read and import.** An unknown or non-string mode from an import or corrupt storage no longer makes the popup and Options show Off while Smart is enforced, and no longer crashes them (#875).
- **Protection Center reasons.** Real stored events, including credential reason codes and blocked new-tab prompts, now show readable reasons instead of raw codes (#878). Scores above 100, which the risk formula produces for the riskiest blocks, are shown as 100 instead of being dropped (#888).
- **Toast and journal tidy-ups:** rollback and ClickFix toasts show one Dismiss button, oversized legacy journal rows are re-capped once without rewriting already-bounded rows, and imported trusted domains keep valid hostnames only (#880).
- **Local journal reliability.** One failed read of the reset marker no longer blocks every later event-log write until the service worker restarts, and the prompt-outcome log is no longer rewritten on every worker start (#892).
- **Smaller fixes:** detached elements get opacity 1 instead of `NaN` (#854), and write-only persisted fields were dropped (#841). A replaced credential prompt no longer leaks its pending promise or restores focus too early (#122). `__proto__` lookups are guarded, `normalizeHost` strips every trailing dot (#165, #167, #170), and `SuiteSettingsPatch.credential.similarity` is a true partial (direct commit). Silent failures now log diagnostics (#156, #157, #168, #169).

### Security

- **Pages cannot operate NavSentinel's own controls.** Page-script clicks, key presses, Escape and backdrop clicks no longer activate or dismiss credential-prompt, navigation and rollback controls such as Allow, Proceed and Trust, and a synthetic Tab no longer moves focus between the credential prompt's actions. Real keyboard and assistive-technology input still works (#784, #827, #889). Page script can still call `.focus()` on an action through the prompt's open shadow root (issue #894, open).
- **Synthetic events grant no navigation authority.** Page-generated pointer and click events no longer allow navigations or popups in the service worker or the MAIN world (#464).
- **Child-frame authority.** A trusted click inside a child frame no longer grants tab-wide navigation allowance unless the frame declared a destination, either a link to another document or a form submit control. Such navigations fall through to the existing redirect rollback (#636). A child frame's form allowance applies only to the action of the clicked submit control (#649).
- **Allow-once is bound to the approved URL.** It is consumed only by a `window.open` of that exact URL, so another page-initiated open cannot use or burn it (#852).
- **Pending decisions** are bound to Chrome-derived tab, frame and document context, and only the latest decision for a context can be shown or used (#466, #711).
- **Credential submit hardening.** The prompt now assesses the submit button's `formaction`, catches disabled decoy fields and form-associated inputs, and re-checks the destination after the prompt and after the trust write. Analyzer exceptions no longer bypass the guard, and the one-shot bypass is scoped to its own re-dispatch (#263, #281, #342, #364).
- **`<base href>` can no longer disguise a credential destination.** Form actions, SRI resource URLs and the page-wide form scan now resolve against the document base URL, as the browser does (#776, #788, #823).
- **Upper-case attribute values no longer evade detection.** `type="PASSWORD"` fields, submit controls, `target` values and stylesheet `rel` tokens now match case-insensitively (#821, #823).
- **MAIN-world bridge hardening:** a challenge-response handshake before a port is accepted (issue #86), a generation counter so stale retries cannot close a live port (issue #90), an order-preserving outbound buffer with a handshake timeout (#185), and reserved queue slots so floods cannot crowd out rare signals (#384). Before the bridge is verified, clipboard receipts collapse to the latest command-like and the latest other receipt, so a clipboard flood cannot crowd out the fake-verification warning (#599). MAIN-world code no longer exposes the extension ID (#85), MAIN-world patches resist bypass and fingerprinting (#79), protocol injection and `lastError` handling were fixed (#89), and rollback URLs and TTLs are validated (#88). The handshake proves possession of the port, not the isolated world's identity (issue #186, open): a page that races the handshake can switch the in-page guard off for itself, while the service-worker rollback and the isolated-world detectors keep running.
- **Bridge timing belongs to the receiver.** Clipboard, pushState, double-click and shadow-prompt correlation use the isolated world's receipt time, and MAIN-world timing uses a `Date.now` captured at start-up, so later page changes to `Date.now` cannot stretch those windows (#757). An inline script that runs before that capture can still replace it (issue #877, open).
- **Allowlist writes are serialized in the service worker** and ordered with import, reset and migration. Content scripts may only add or migrate entries, and remove, clear and replace require an extension page (#761).
- **Rollback cannot be dodged by a same-document URL rewrite:** staleness is judged against the committed URL, not a `pushState`-changed one (#856).
- **Hostile pages cannot blind detection.** Deeply nested shadow DOM no longer crashes the mutation monitor, and one throwing record or callback affects only itself (#814, #771).
- **ClickFix and iframe allowlists** match parsed hostnames instead of substrings, and a real CAPTCHA provider iframe must be rendered before it suppresses the ClickFix text signal (#210, #230, #386).
- **Trust lists trimmed:** three brand-alias and tracking-prefix entries whose ownership or registration could not be verified were removed (#529).
- **Local data minimisation:** event-log URLs are reduced to origin and path (#468), likely-secret path segments are redacted (#517), and prompt outcomes keep hostnames only (#518). They apply to new records, imports and exports, and existing data is migrated.
- **Bounded local journal.** Event text and extras are capped on live appends and imports so a page cannot exhaust storage quota (#311, #830). Exports revalidate page sites to a canonical hostname or IP and omit anything else (#696).

### Removed

- **Visual similarity detection**, including its runtime, brand-template asset, viewport capture and scoring factor. It had only placeholder templates (#514; previously #109, #110, #111, #146, #172, #174, #187).
- **The placeholder `declarativeNetRequest` ruleset,** its "DNR backstop / Experimental hard blocklist" Options toggle and the related permissions. The two rules were localhost-scoped test rules and gave users no protection; the stored flag is dropped on upgrade (#528).
- **URL-reputation filtering from the release build.** The bloom filter and its data ship only in the unpacked `research-reputation` build (#509).
- **`Location.prototype.assign`/`replace` wrappers.** They never intercepted `location.assign()` or `location.replace()`, and the documentation now states the real interception boundary (#534).
- **The repository-local agent harness** (hooks, command floor and harness CI) was retired by owner decision (#501; earlier harness PRs #248, #438, #457, #467, #469, #472, #482, #486, #487, #492, #500).

## [0.4.0] - 2026-05-03

### Added
- DoubleClickjacking detection -- detects and blocks double-click hijack attacks
- ClickFix / fake CAPTCHA detection -- identifies clipboard-hijacking fake verification dialogs
- Local bloom filter URL reputation -- catches known-bad domains without network calls
- Page content fingerprinting -- detects brand/domain mismatches and phishing kit patterns
- OAuth consent flow monitoring -- tracks and flags suspicious OAuth redirect patterns
- Redirect chain correlation -- scores multi-hop redirect chains as a unit
- DOM mutation monitoring -- detects post-load overlay injection and form manipulation
- History.pushState gating -- flags suspicious URL manipulation after user gestures
- NRS scoring ceiling with diminishing returns above 100 points
- ClickFix scoring integration into NRS pipeline
- Bloom filter per-frame loading optimization (top-frame only, SW fallback for child frames)
- Smart defaults with allowlist suggestions after repeated allows
- Service worker state migration to chrome.storage.session for restart resilience
- jsdom test environment for ClickFix DOM tests
- Bloom filter size monitoring in CI (2MB cap)
- Issue templates for bug reports, feature requests, false positives, and security vulnerabilities
- Comprehensive Phase 2 gym fixtures and E2E tests (22 tests across 6 detection types)

### Changed
- NRS now applies diminishing returns for scores above 100
- Previously-allowed popups reduce NRS by 20 points

## [0.3.0] - 2026-05-02

### Added
- Navigation Risk Score (NRS) -- composite scoring layering CDS with navigation context
- Public Suffix List integration -- accurate registrable domain extraction for cloud-hosted domains
- Enhanced lookalike detection -- subdomain stuffing, visual homoglyphs, brand keyword matching
- CDS evasion hardening -- gradient scoring, composite escalation, no single-factor bypass
- False positive measurement infrastructure (Tranco top-200)
- Real-world phishing test corpus infrastructure (100 pages)
- CDS evasion red-team test suite
- Local prompt telemetry -- tracks allow/block/trust/dismiss outcomes locally
- Same-organization domain groups to suppress cross-site penalty for multi-domain ecosystems

## [0.2.0] - 2026-04-25

### Added
- Property tests for CDS scoring and state machine (fast-check)
- Wave 5 gym fixtures (RW-21 through RW-25) and stress test infrastructure
- Stress test lane in CI (nightly schedule)
- Recovered 13 missing Wave 2-4 E2E tests

### Changed
- Archived stale planning documents (Execution_Tracker, Implementation_Roadmap)
- Cleaned up stale remote branches

## [0.1.0] - 2026-03-01

### Added
- Initial release with navigation intent firewall
- Click Deception Score (CDS) -- 9-factor composite scoring for overlay/clickjacking detection
- Credential submission guardrails -- domain trust, risk scoring, paste warnings
- Allowlist system with per-source-destination entries
- Debug overlay for development
- Gym test fixtures for deterministic local testing
- E2E test suite with Playwright
