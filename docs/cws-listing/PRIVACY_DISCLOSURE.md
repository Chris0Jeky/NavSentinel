# NavSentinel — Chrome Web Store Privacy Disclosure

## Privacy Practices Tab

### Single Purpose
NavSentinel protects users from interaction-level browser attacks (DoubleClickjacking, ClickFix overlays, redirect chains, credential phishing) by monitoring click context and navigation patterns locally.

### Permission Justifications

| Permission | Justification |
|-----------|---------------|
| `storage` | Stores user settings, navigation allowlist, trusted domain list, and local event log. All data stays local. |
| `declarativeNetRequest` | Reserved for future static redirect-interception rules. Currently contains only localhost-scoped test stubs. Rules are declarative and bundled at build time. |
| `webNavigation` | Monitors navigation commits to detect redirect chains, rollback suspicious navigations, and correlate gesture tokens with navigation events. |
| `tabs` | Tracks tab creation/closure for DoubleClickjacking detection (child window monitoring) and rollback affordances. |
| `host_permissions: <all_urls>` | Content scripts must run on all pages to detect click deception, credential risks, and overlay attacks. No data is collected or transmitted. |

### Data Usage Disclosure

**Data collected**: None transmitted. All data stays in local browser storage.

**Data stored locally**:
- Extension settings (navigation mode, credential mode, thresholds)
- Navigation allowlist (user-approved site pairs)
- Trusted credential domains (user-configured)
- Local event log (bounded, contains event kind, timestamp, site, risk scores). Routine navigations record the destination **host only** — never full URLs, paths, or query strings. Credential-form events record the submitting page's URL and the form-action host, the same as the existing prompted credential events.
- Prompt outcome statistics (domain pairs, allow/block counts for smart defaults)
- Ephemeral session state (gesture tokens, rollback state — cleared on browser close)

**Data NOT collected or transmitted**:
- No browsing history sent anywhere
- No personal information collected
- No clipboard content stored (only metadata: length and boolean command-like indicator)
- No credentials or passwords stored or transmitted
- No analytics, telemetry, or crash reports
- No third-party tracking or advertising

### Remote Code
This extension does not use remote code. All JavaScript is bundled at build time. Two static data assets (a Public Suffix List snapshot and a known-bad-domain bloom filter) are compiled at build time and never updated at runtime. The PSL snapshot is generated from a public source; the bloom filter currently ships a placeholder test dataset built from reserved `.example` domains, with the production build from public threat feeds (URLhaus, OpenPhish) tracked as release-blocker #321.

### Content Security Policy
The extension uses the default Manifest V3 CSP. No `unsafe-eval` or remote script loading.

## Certification Answers

**Does your extension request or use the `activeTab` permission?** No.

**Does your extension collect any user data?** No data is transmitted. Local storage only.

**Will your extension be used for cryptocurrency mining?** No.

**Does your extension use remote code or resources?** No. All code is bundled at build time.
