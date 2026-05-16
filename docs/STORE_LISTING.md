# Chrome Web Store Listing — NavSentinel

## Title
NavSentinel — Browser Defense Against Deceptive Navigation

## Summary (132 chars)
Local-first browser defense against click hijacking, deceptive redirects, and credential phishing. No cloud lookups. Open source.

## Description

NavSentinel protects two high-risk browser surfaces that other extensions miss: **deceptive navigation** and **credential phishing**.

It analyzes the interaction itself — the click, the overlay, the timing — instead of trusting URL blocklists. Decisions are made entirely in your browser. No cloud lookups. No telemetry. Open source.

### What it catches

- **Click hijacking & invisible overlays** — DoubleClickjacking, ClickFix patterns, cursor-under-overlay attacks
- **Unauthorized popups and popunders** — new-tab flows that don't match user intent
- **Cross-site redirect manipulation** — redirect chains, phishing redirects, oauth abuse flows
- **Credential phishing & lookalikes** — edit-distance domain matching against known brands
- **Punycode and homoglyph domains** — internationalized domain spoofing
- **IP-address login forms** — credential submission to raw IP destinations
- **Password paste into untrusted forms** — clipboard exfiltration prevention
- **HTTP credential submissions** — non-HTTPS form action blocking

### How it works

1. **Navigation Risk Score (NRS)** — Every click is scored across 13 behavioral signals. High-risk navigations get prompted or blocked.
2. **Click Deception Score (CDS)** — Overlay geometry, visibility, and timing are analyzed to detect UI redress attacks.
3. **Credential Guard** — Password form submissions are validated against a local trust list and lookalike brand database.

### Key principles

- **Local-only** — Zero network calls. All scoring happens in your browser.
- **Transparent** — Every decision is logged with the exact signals that triggered it.
- **Tunable** — Three modes (Off/Smart/Strict) and per-domain trust controls.
- **Open source** — MIT license. Inspect every line of code.

### Permissions explained

- `storage` — Saves settings, event log, and trust lists locally
- `declarativeNetRequest` — Static blocklist backstop (optional, experimental)
- `webNavigation` — Detects navigation events for scoring
- `tabs` — Reads active tab URL for popup display
- Host permissions — Content scripts that monitor click interactions

## Category
Privacy & Security

## Language
English

## Developer
Chris0Jeky

## Assets needed

| Asset | Dimensions | Status |
|-------|-----------|--------|
| Extension icon | 128×128 PNG | Done (icon128.png) |
| Small promo tile | 440×280 | Needs screenshot |
| Large promo tile | 1400×560 | Needs screenshot |
| Screenshot 1 | 1280×800 | Popup in browser context |
| Screenshot 2 | 1280×800 | Analytics dashboard |
| Screenshot 3 | 1280×800 | Credential block modal |
| Screenshot 4 | 1280×800 | Scoring transparency |

See `RESOURCES/redesign/components/store.jsx` for visual reference of all promotional assets.
