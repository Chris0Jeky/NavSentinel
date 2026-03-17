# Privacy

NavSentinel is designed to stay local-first and avoid data exfiltration.

## What the extension does

- Intercepts selected user interactions such as clicks, popup attempts, navigations, and password-form submits.
- Scores risky behavior locally and shows prompts, toasts, or modal warnings inside the page.
- Stores local trust decisions so repeated prompts are reduced over time.

## What is stored locally

Stored in `chrome.storage.local`:

- Suite settings for navigation and credential-guard behavior
- Navigation allowlist entries
- Trusted domains for credential-submit protection
- A bounded event log containing timestamps, sites, destination hosts, decisions, and reason codes

The event log can be cleared or exported from the options page.

## What is not collected

NavSentinel does not:

- send telemetry
- call remote reputation services
- upload browsing history
- store password values
- inspect clipboard contents
- capture page text or screenshots

## Import and export

The options page supports manual JSON export and import of settings, allowlists, trusted domains, and the local event log.

Nothing is exported automatically.

## Network behavior

The protection logic makes no external network calls.

Local development/demo utilities may start local servers for Gym testing only.
