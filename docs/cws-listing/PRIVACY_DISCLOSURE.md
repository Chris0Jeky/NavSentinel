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
| `webNavigation` | Monitors navigation commits to detect redirect chains, rollback suspicious navigations, and correlate gesture tokens with navigation events. |
| `tabs` | Tracks tab creation/closure for DoubleClickjacking detection (child window monitoring) and rollback affordances. |
| `host_permissions: <all_urls>` | Content scripts must run on all pages to detect click deception, credential risks, and overlay attacks. Interaction data is processed locally and configured security history may be stored locally; nothing is transmitted. |

### Data Usage Disclosure

**Data transmitted**: None. Processing and configured history stay in the local browser.

**Current CWS user-data categories handled locally**:

- web browsing activity: visited/source/destination domains and, where current
  correctness paths still require them, exact navigation/redirect/OAuth URLs;
- website content and resources: bounded page text/HTML and structural
  click/element signals, plus transient clipboard text/selection used to derive
  command metadata; raw content is processed locally but is not stored,
  exported, or transmitted;
- form and authentication context: password-field presence, submit destination,
  and OAuth callback context—not password values or form-field contents;
- user interactions and security decisions: timestamps, allow/block/trust
  outcomes, scores, reasons, and bounded structural context; and
- settings, allow/trust lists, adaptive/domain/category profiles, cooldowns,
  and ephemeral protection state.

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
exported. Options can clear the log, prompt/adaptive stats, and domain profiles
individually, and **Clear behavioural data** (Analytics pane) resets all four of
those stores in one service-worker-owned pass while keeping settings, the
allowlist, and trusted domains. Navigation-category counts and smart-default
cooldowns are NOT covered by that reset and still have no user-facing clear
control. The behavioural-data boundary is a stated implementation assumption
until the owner rules on #474; RI-06 also still requires purpose-specific URL
minimization sign-off before beta.

**Development-build viewport processing:** the current non-functional
visual-sim experiment can capture the visible tab locally for comparison when a
password page requests analysis. It does not store or transmit the image, but it
can select the wrong active tab. RI-02 requires complete removal before beta; if
any visual processing remains, this disclosure and the CWS data-use answers must
be reviewed again.

**Data not transmitted or retained as raw content**:
- No browsing history sent anywhere
- No personal information is requested as a product field; current full-URL
  retention can nevertheless contain user/site identifiers and must be
  minimized under RI-06
- Clipboard text/selection is inspected transiently in the page's MAIN world to
  derive length and a command-like boolean. Content is not bridged to the
  isolated script, stored, or transmitted.
- No password values or form-field contents are stored or transmitted. Current
  exact operational URLs can contain OAuth authorization codes, access/ID
  tokens, or other response parameters; RI-06/#455 must redact these before any
  storage, export, or logging and minimize any strictly required residual while
  preserving host/target binding.
- No analytics, telemetry, or crash reports
- No third-party tracking or advertising

### Remote Code
This extension does not use remote code. All JavaScript is bundled at build
time. The Public Suffix List is a static generated asset. The release-eligible
interaction-only profile contains no reputation runtime or asset; the separate
reserved-domain research fixture is non-release and cannot be packaged.

### Content Security Policy
The extension uses the default Manifest V3 CSP. No `unsafe-eval` or remote script loading.

## Prominent Disclosure And Consent — Beta Blocker

Chrome's [2026 policy update](https://developer.chrome.com/blog/cws-policy-updates-2026)
requires prominent disclosure of all collected data regardless of relation to
the extension's single purpose, with enforcement beginning 2026-08-01. The
[official FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/)
confirms that local processing/storage counts. #455 must prove two separate
boundaries rather than assuming onboarding satisfies both:

1. **Before installation:** the CWS listing and Privacy Practices fields
   prominently disclose every category/use, and the actual CWS install flow
   supplies affirmative informed consent. Record the exact dashboard/install
   UI and dated evidence at submission; if its consent semantics are unclear,
   obtain CWS support confirmation before inviting users.
2. **After installation, before handling:** the installed extension remains
   passive until an in-product disclosure repeats the categories/uses and the
   user affirmatively enables protection.

The current development build starts content scripts at `document_start` and
does not yet have that activation boundary. #455/PM-03 therefore blocks beta:
fresh installs must remain passive until the pre-install listing and in-product
onboarding disclose every category/use above and the user affirmatively enables
protection. Tests must cover pre-consent passivity, activation, revocation,
reset, and redaction of OAuth `code`, `access_token`, and `id_token` values
before storage/export/logging.

### Limited Use Declaration

NavSentinel's use of information received through Chrome APIs adheres to the
Chrome Web Store User Data Policy, including the Limited Use requirements. Data
is used only to provide or improve the disclosed local security purpose; it is
not transferred for advertising, credit, data-broker, or unrelated purposes.

## Certification Answers

**Does your extension request or use the `activeTab` permission?** No.

**Does your extension collect any user data?** Re-answer in the CWS dashboard
against the final package and current CWS definitions. **Yes** under the current
policy: the extension locally handles the categories listed above even though
it does not transmit them.

**Will your extension be used for cryptocurrency mining?** No.

**Does your extension use remote code or resources?** No. All code is bundled at build time.
