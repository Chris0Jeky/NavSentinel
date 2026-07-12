# NavSentinel — Chrome Web Store Privacy Disclosure

## Privacy Practices Tab

### Single Purpose
NavSentinel is designed to protect users from interaction-level browser attacks
(DoubleClickjacking, ClickFix overlays, redirect chains, credential phishing)
by monitoring click context and navigation patterns locally.

### Permission Justifications

| Permission | Justification |
|-----------|---------------|
| `storage` | Stores settings, allow/trust lists, event and prompt-outcome history, adaptive/domain/category behavior profiles, smart-default cooldowns, and ephemeral security state. Nothing is transmitted. |
| `declarativeNetRequest` | **Remove before beta.** The current ruleset contains localhost test stubs only and is not a user feature. |
| `webNavigation` | Monitors navigation commits to detect redirect chains, rollback suspicious navigations, and correlate gesture tokens with navigation events. |
| `tabs` | Tracks tab creation/closure for DoubleClickjacking detection (child window monitoring) and rollback affordances. |
| `host_permissions: <all_urls>` | Content scripts must run on all pages to detect click deception, credential risks, and overlay attacks. Interaction data is processed locally and configured security history may be stored locally; nothing is transmitted. |

### Data Usage Disclosure

**Data transmitted**: None. Processing and configured history stay in the local browser.

**Data stored locally**:

- Settings, navigation allowlist, and trusted credential domains.
- Bounded event log (50–5,000 entries) and latest 500 prompt outcomes. These can
  contain timestamps, domains, outcomes, scores, reasons, bounded structural
  click context, and—in some credential/event paths—the submitting page URL.
- Adaptive per-domain scores (up to 200), domain behavior profiles (up to 500),
  navigation-category counts/bursts, and 24-hour smart-default cooldown pairs
  (up to 200).
- Ephemeral session state, including gesture/allow tokens and exact rollback,
  forward, redirect, and OAuth URLs needed for correctness. It is cleared on
  browser close.

The current export includes settings, allow/trust lists, event log, prompt
outcomes, and adaptive scores. Domain/category profiles and cooldowns are not
exported. Options can clear the log, prompt/adaptive stats, and domain profiles;
RI-06 must add a complete behavioral reset and purpose-specific URL
minimization before beta.

**Development-build viewport processing:** the current non-functional
visual-sim experiment can capture the visible tab locally for comparison when a
password page requests analysis. It does not store or transmit the image, but it
can select the wrong active tab. RI-02 requires complete removal before beta; if
any visual processing remains, this disclosure and the CWS data-use answers must
be reviewed again.

**Data not transmitted or intentionally captured as content**:
- No browsing history sent anywhere
- No personal information is requested as a product field; current full-URL
  retention can nevertheless contain user/site identifiers and must be
  minimized under RI-06
- Clipboard text/selection is inspected transiently in the page's MAIN world to
  derive length and a command-like boolean. Content is not bridged to the
  isolated script, stored, or transmitted.
- No password values, authentication tokens, or form-field contents are stored
  or transmitted
- No analytics, telemetry, or crash reports
- No third-party tracking or advertising

### Remote Code
This extension does not use remote code. All JavaScript is bundled at build
time. The Public Suffix List is a static generated asset. The current bloom
binary is a reserved-domain test fixture, not production threat intelligence;
AI-9 decides whether the beta omits reputation or ships a separately reviewed,
reproducible real-filter profile.

### Content Security Policy
The extension uses the default Manifest V3 CSP. No `unsafe-eval` or remote script loading.

## Certification Answers

**Does your extension request or use the `activeTab` permission?** No.

**Does your extension collect any user data?** Re-answer in the CWS dashboard
against the final package and current CWS definitions. The extension processes
browsing interactions and keeps configured security history locally; it does not
transmit that data.

**Will your extension be used for cryptocurrency mining?** No.

**Does your extension use remote code or resources?** No. All code is bundled at build time.
