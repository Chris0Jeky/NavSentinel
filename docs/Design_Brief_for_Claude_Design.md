# NavSentinel — Complete Design Brief for Claude Design

> **Historical design input:** do not reuse its name, competitive copy, feature
> counts, or release claims without reconciling them against
> `Product_Strategy.md` and `docs/cws-listing/STORE_LISTING.md`. The product name
> is pending AI-19 and the beta feature profile is narrower than this brief.

> **Purpose**: This document gives Claude Design (or any designer) everything needed to create four UI surfaces for NavSentinel: a product landing page, an extension popup, a settings/control-panel page, and the Chrome Web Store listing page. It includes copy, feature lists, architecture details, visual direction, and operational prompts.

---

## Table of Contents

1. [Product Identity](#1-product-identity)
2. [Design Surfaces Overview](#2-design-surfaces-overview)
3. [Surface 1: Landing Page](#3-surface-1-landing-page)
4. [Surface 2: Extension Popup](#4-surface-2-extension-popup)
5. [Surface 3: Options / Control Panel](#5-surface-3-options--control-panel)
6. [Surface 4: Chrome Web Store Page](#6-surface-4-chrome-web-store-page)
7. [Content Library — Features & Copy](#7-content-library)
8. [Architecture & Technical Storytelling](#8-architecture--technical-storytelling)
9. [Stats, Numbers & Proof Points](#9-stats-numbers--proof-points)
10. [Visual Direction & Mood](#10-visual-direction--mood)
11. [Current State Reference](#11-current-state-reference)
12. [Operational Prompts for Claude Design](#12-operational-prompts-for-claude-design)

---

## 1. Product Identity

| Field | Value |
|-------|-------|
| **Name** | NavSentinel |
| **Tagline** | "Catches what Safe Browsing can't see" |
| **Subtitle** | Local-first browser defense against deceptive navigation and credential theft |
| **Version** | 0.2.1 (pre-release, actively developed) |
| **Type** | Chrome MV3 browser extension |
| **Author** | Chris0Jeky (solo developer, AI-assisted workflow) |
| **License** | Open source |
| **Repo** | github.com/Chris0Jeky/NavSentinel |
| **Core philosophy** | Everything stays local. No telemetry. No cloud lookups. No password storage. Pure client-side heuristics. |

### Brand Voice
- **Tone**: Technical but accessible. Like a security researcher explaining their work to a smart friend.
- **Personality**: Precise, confident, transparent. Not corporate. Not salesy. Think "open-source security tool built by someone who actually understands the attacks."
- **Audience**: Security-conscious developers, privacy enthusiasts, power users, infosec professionals, CTF players, people who read Krebs on Security.

### Logo / Icon
- Current icon is a placeholder ("CS" on dark rounded square with blue border and red dot).
- **Desired direction**: The letters "NS" or a shield/sentinel motif. Dark background, accent colors from the existing palette (cyan, green). Should feel technical/hacker-aesthetic, not corporate security.
- Icon sizes needed: 16px, 32px, 48px, 128px (Chrome extension requirements).

---

## 2. Design Surfaces Overview

| Surface | Dimensions / Format | Purpose |
|---------|-------------------|---------|
| **Landing Page** | Full responsive webpage | Product showcase, documentation, "about" page |
| **Extension Popup** | 372px wide, variable height | Quick per-tab status & controls |
| **Options / Control Panel** | Full browser tab (max 1100px) | Deep configuration, logs, analytics |
| **Chrome Web Store Page** | Store listing format (screenshots, description) | Distribution & first impression |

---

## 3. Surface 1: Landing Page

### Page Goal
A single-page product site that looks like a technical security tool — not a SaaS landing page. Think GitHub README meets security research paper meets indie hacker product page. Should make a security researcher think "this person knows what they're doing."

### Proposed Sections

#### Hero Section
- **Headline**: "NavSentinel"
- **Subheadline**: "Catches what Safe Browsing can't see"
- **Body**: "A local-first Chrome extension that detects deceptive overlays, click hijacking, popup abuse, credential phishing, and redirect manipulation — using pure client-side heuristics. No cloud. No telemetry. No trust required."
- **CTA**: "Install from Chrome Web Store" + "View on GitHub"
- **Visual**: Animated or static diagram showing the extension intercepting a deceptive click in real-time. Or a stylized browser window with the NavSentinel popup visible.

#### "What It Catches" Section
A grid of attack categories with icons and brief descriptions:

| Attack | One-liner |
|--------|-----------|
| **Click Hijacking** | Detects invisible overlays, opacity tricks, and retargeted clicks that redirect your interaction to a hidden element |
| **Popup Deception** | Blocks unauthorized window.open() calls, popunders, and programmatic navigation outside your gesture window |
| **Redirect Manipulation** | Catches delayed redirects, cross-site bounces, and location.assign() abuse — with automatic rollback |
| **Credential Phishing** | Warns before password submission to lookalike domains, HTTP endpoints, IP addresses, and cross-site form actions |
| **Homoglyph Attacks** | Detects Punycode domains, mixed-script hostnames, and visual lookalikes of 42 major brands |
| **DoubleClickjacking** | (Coming soon) First extension to detect window.opener manipulation after double-click events |

#### "How It Works" — Architecture Deep Dive
A technical section for the geeky audience. Include a diagram:

```
┌─────────────────────────────────────────────────┐
│                   YOUR BROWSER                   │
│                                                  │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │  Main World  │    │    Isolated World      │  │
│  │              │    │                        │  │
│  │ main_guard   │◄──►│  capture_isolated      │  │
│  │  Patches:    │    │   Click context        │  │
│  │  window.open │    │   CDS scoring          │  │
│  │  location.*  │    │   NRS computation      │  │
│  │  form.submit │    │   Decision engine      │  │
│  │              │    │                        │  │
│  │              │    │  credential_guard       │  │
│  │              │    │   Form interception     │  │
│  │              │    │   Domain risk scoring   │  │
│  │              │    │   Modal prompts         │  │
│  └──────┬───────┘    └──────────┬─────────────┘  │
│         │  MessagePort bridge   │                 │
│         │  (cryptographic       │                 │
│         │   session ID)         │                 │
│         └───────────┬───────────┘                 │
│                     │                             │
│              ┌──────▼──────┐                      │
│              │   Service   │                      │
│              │   Worker    │                      │
│              │  Tab state  │                      │
│              │  Rollback   │                      │
│              │  DNR sync   │                      │
│              └─────────────┘                      │
│                                                   │
│  ┌──────────┐  ┌──────────────┐                   │
│  │  Popup   │  │   Options    │                   │
│  │  Quick   │  │   Deep       │                   │
│  │  control │  │   config     │                   │
│  └──────────┘  └──────────────┘                   │
└─────────────────────────────────────────────────┘
                    ▲
                    │ Everything stays here.
                    │ Nothing leaves the browser.
                    ▼
              ┌───────────┐
              │  Storage   │
              │  (local)   │
              │  Settings  │
              │  Logs      │
              │  Trust DB  │
              └───────────┘
```

#### Scoring System Explainer
A visual breakdown of the three-tier scoring:

**Tier 1: Click Deception Score (CDS)** — 0-100 scale
Analyzes the click target itself:
- Is the element invisible or near-invisible? (+25)
- Does it cover >35% of the viewport? (+30)
- Is there a more meaningful element underneath? (+35)
- Was the click retargeted to a different element? (+20)
- Extreme z-index stacking? (+15)
- No accessible name on interactive element? (+15)
- Multiple weak signals compound (+10-15 composite escalation)

**Tier 2: Navigation Risk Score (NRS)** — CDS + context
Layers behavioral signals onto the CDS:
- Opening a new tab/window? (+20)
- Cross-site destination? (+20)
- Suspiciously fast (<250ms)? (+10)
- Multiple attempts in one gesture? (+25)
- User explicitly intended new tab (Ctrl+click)? (-30)
- Destination already allowlisted? (-100)

**Tier 3: Decision**
- NRS < 40 → Allow silently
- NRS 40-69 → Prompt user (Smart mode)
- NRS ≥ 70 → Block (Smart mode) / NRS ≥ 50 → Block (Strict mode)

**Credential Risk Score** — Independent 0-100 scale
- Non-HTTPS page? (+55)
- Lookalike of trusted domain? (+45)
- Brand keyword in suspicious domain? (+40)
- IP address instead of domain? (+35)
- Cross-site form submission? (+18)
- Punycode or mixed-script hostname? (+25)

#### "What Makes It Different" Section

| Traditional Extensions | NavSentinel |
|----------------------|-------------|
| Check URLs against cloud blocklists | Analyzes the *interaction itself* — the click, the overlay, the timing |
| Require you to trust a reputation service | Runs entirely locally — zero network calls |
| Miss novel attacks not yet in databases | Catches attacks by *behavior*, not by URL signature |
| Block known-bad domains | Detects deceptive *patterns* on any domain |
| Store your browsing data | Stores nothing outside your browser's local storage |

#### "Privacy by Architecture" Section
- Zero remote telemetry
- Zero cloud reputation lookups
- Zero password value storage
- Zero clipboard content capture
- All settings, logs, and trust data stored in chrome.storage.local
- Event log contains reason codes and interaction metadata — never credentials
- Fully auditable: open-source, every decision has explainable reason codes
- Import/export your configuration as JSON — full data portability

#### Protection Modes Section
Two independent protection axes:

**Navigation Protection:**
| Mode | Behavior |
|------|----------|
| Off | No intervention. For debugging only. |
| Smart | Blocks clearly deceptive interactions. Allows ordinary navigation and legitimate _blank links. Recommended for daily use. |
| Strict | Lowers blocking threshold. Catches more edge cases but may prompt on legitimate sites. Good for adversarial testing. |

**Credential Protection:**
| Mode | Behavior |
|------|----------|
| Off | No password form monitoring. |
| Smart | Prompts on untrusted domains, medium/high risk submissions. Warns on password paste into untrusted sites. |
| Strict | Aggressive prompting for all non-trusted submissions. Best for high-security workflows. |

#### Gym / Testing Section
"NavSentinel ships with a **Gym** — a suite of 78 deterministic HTML test fixtures that simulate real attack patterns."

- **12 graduated attack levels**: From basic opacity overlays to complex redirect chains
- **11 evasion technique tests**: Attackers trying to sneak past the scoring (gradient opacity, CSS clip-path, Shadow DOM, pointer-events manipulation)
- **55 real-world scenarios**: Modeled after actual attacks seen in the wild (fake download CTAs, browser update scams, invoice approval phishing, wallet connect bursts, tech-support scares)

Include a visual showing the Gym interface or a grid of test scenario cards.

#### Brand Protection
"NavSentinel monitors for lookalike attacks against **42 major brands**:"

Google, Gmail, YouTube, Apple, iCloud, Microsoft, Outlook, Amazon, PayPal, Netflix, Facebook, Instagram, WhatsApp, Twitter/X, LinkedIn, Dropbox, Adobe, Spotify, eBay, Chase, Wells Fargo, Bank of America, Citibank, Capital One, American Express, HSBC, Barclays, Coinbase, Binance, Kraken, Blockchain, Stripe, Shopify, Walmart, Best Buy, GitHub, GitLab, Discord, Reddit, Yahoo, DocuSign, US Bank

#### Roadmap / Coming Soon Section
Tease future capabilities to build excitement:
- **DoubleClickjacking detection** — First consumer extension to catch this attack
- **ClickFix / Fake CAPTCHA detection** — Overlay + clipboard write pattern recognition
- **Local bloom filter URL reputation** — 60-70% phishing catch rate without network calls
- **Page content fingerprinting** — Brand/domain mismatch detection
- **OAuth consent flow monitoring** — Post-flow redirect flagging
- **DOM mutation monitoring** — Post-load overlay injection detection
- **Redirect chain correlation** — Multi-hop scoring as a unit
- **Visual similarity detection** — Perceptual hashing against brand templates
- **Cross-browser support** — Firefox MV3 port

#### Installation & Quick Start
```
1. Clone the repo or download from Chrome Web Store
2. npm install && npm run build
3. Load extension/dist/ as unpacked extension in chrome://extensions
4. Click the NavSentinel icon — set your preferred protection modes
5. Browse normally. NavSentinel works silently until it detects something.
6. Check the options page for event logs, statistics, and fine-tuning.
```

#### Footer
- GitHub link
- License info
- "Built by Chris0Jeky" with a link
- "No tracking. No telemetry. Just math."

---

## 4. Surface 2: Extension Popup (372px wide)

### Current Design
The popup currently has a dark theme with glassmorphism effects. It shows:
- Header with "NavSentinel Suite" title and version
- Current site display with trust status pill
- Two mode dropdowns (Navigation / Credential)
- Trust/Untrust buttons
- Recent events list (up to 6 events)
- Footer: "Local log only. Nothing leaves the browser."

### Design Brief for Redesign

**Goal**: Make it feel like a mission control panel. Think fighter-jet HUD meets terminal aesthetic. Compact but information-dense.

**Layout (top to bottom):**

1. **Header bar** (compact)
   - NavSentinel logo mark (small)
   - Current site hostname (monospace, truncated)
   - Trust status indicator (green dot = trusted, orange = caution, red = untrusted, gray = unknown)

2. **Protection status strip**
   - Two compact mode selectors side by side:
     - Nav: Off / Smart / Strict (segmented control or compact dropdown)
     - Cred: Off / Smart / Strict
   - Visual indicator of current protection level (color bar or shield icon that changes)

3. **Live threat assessment** (for current page)
   - Current page risk level (None / Low / Medium / High) with color coding
   - Number of events detected on this tab
   - Active signals (if any) — tiny chips showing active reason codes

4. **Recent activity feed** (scrollable, max 5-6 items)
   - Event cards with:
     - Icon by type (shield for nav, key for credential, gear for config)
     - Event type label
     - Timestamp (relative: "2m ago")
     - Brief detail (site, score, top signal)
   - Color-coded left border by severity

5. **Quick actions row**
   - "Trust this site" / "Remove trust" toggle button
   - "Open dashboard" link (opens options page)

6. **Footer**
   - "Everything stays local" — single line, muted

**Color Palette:**
- Background: Deep navy/charcoal (#0d1117 or similar)
- Cards: Slightly lighter with subtle border (#161b22)
- Accent cyan: #8ed2ff (navigation events)
- Accent green: #71e6b4 (credential events, trusted state)
- Accent orange: #ffd166 (warnings, caution state)
- Accent red: #ff6b6b (blocks, danger)
- Text: White primary, gray-400 secondary

**Typography:**
- Headers: System sans-serif, bold
- Data values: Monospace (scores, hostnames, codes)
- Labels: Small caps or uppercase, muted

---

## 5. Surface 3: Options / Control Panel

### Current Design
Light theme, full-width layout (max 1100px). Has sections for Navigation Protection, Credential Protection, Prompt Statistics, Event Log, Navigation Exceptions, and Credential Exceptions.

### Design Brief for Redesign

**Goal**: Transform into a proper security dashboard / control panel. Think Grafana meets VS Code settings. Dark theme to match the popup and create a cohesive "command center" feel.

**Layout:**

1. **Top navigation bar**
   - NavSentinel logo + "Control Panel"
   - Quick stats row: Total events | Allow rate | Block rate | Avg risk score
   - Version number

2. **Sidebar navigation** (left, collapsible)
   - Protection Settings
   - Threat Analytics
   - Event Log
   - Trust Management
   - Import / Export
   - About

3. **Protection Settings Panel**
   - Two cards side by side:
     - **Navigation Firewall** card: Mode selector, debug toggle, threshold visualization
     - **Credential Guard** card: Mode selector, HTTP block, paste warning, similarity settings, threshold slider with visual indicator
   - Save button with status feedback

4. **Threat Analytics Panel** (the exciting one)
   - **Prompt outcome breakdown**: Donut chart or bar chart showing allow/block/trust/dismiss distribution
   - **Risk score distribution**: Histogram of scores at which users allowed vs blocked
   - **Top triggered domains**: Table with domain, event count, avg score, last seen
   - **Protection timeline**: Line chart showing events over time (if data supports it)
   - **Signal frequency**: Bar chart of most common reason codes
   - Stats cards: Total prompts, Allow rate %, Block rate %, Trust rate %, Avg score at allow, Avg score at block

5. **Event Log Panel**
   - Filterable table/list:
     - Filter by event type (nav/cred/config)
     - Filter by severity
     - Search by domain
   - Each entry expandable to show full detail (all reason codes, scores, URLs)
   - Export JSON / Import JSON buttons
   - Clear log with confirmation
   - Log size indicator (X / limit entries)

6. **Trust Management Panel**
   - **Navigation Allowlist**: Table showing site → allowed destinations, with remove buttons
   - **Credential Trust List**: Domain list with add/remove, visual indicator of how many domains trusted
   - Bulk clear with confirmation dialog

7. **Import / Export Panel**
   - Export full configuration as JSON
   - Import configuration from JSON file
   - Visual diff preview before import (nice-to-have)

**Visual style:**
- Dark theme matching popup
- Card-based layout with subtle borders
- Data visualizations in accent colors
- Monospace for technical values
- Responsive but desktop-first

---

## 6. Surface 4: Chrome Web Store Page

### Store Listing Copy

**Title**: NavSentinel — Browser Defense Against Deceptive Navigation

**Short description** (132 chars max):
"Catches click hijacking, popup deception, redirect manipulation, and credential phishing — locally, with zero cloud dependency."

**Full description:**
```
NavSentinel protects two high-risk browser surfaces that other extensions miss:

🛡️ DECEPTIVE NAVIGATION
Detects invisible overlays, click retargeting, popup abuse, delayed redirects, and window.open manipulation. Scores every suspicious click with a multi-factor Click Deception Score before allowing navigation side effects.

🔑 CREDENTIAL PHISHING
Warns before password submission to lookalike domains, HTTP endpoints, IP addresses, mixed-script hostnames, and untrusted cross-site form actions. Monitors 42 major brands for homoglyph and visual-similarity attacks.

⚡ HOW IT'S DIFFERENT
• Analyzes interactions, not URLs — catches novel attacks that blocklists miss
• 100% local computation — zero cloud calls, zero telemetry, zero trust required
• Three-tier scoring: Click Deception Score → Navigation Risk Score → Decision
• Explainable decisions with detailed reason codes and event logs
• Smart/Strict modes — tune the sensitivity to your threat model
• Ships with 78 test fixtures (the "Gym") to verify detection behavior

🔒 PRIVACY BY ARCHITECTURE
• No remote telemetry or reputation lookups
• No password storage or clipboard capture
• All data stays in chrome.storage.local
• Full JSON export/import for configuration portability
• Open source and fully auditable

PROTECTION MODES:
• Smart (recommended): Blocks clearly deceptive interactions while allowing normal browsing
• Strict: Lower thresholds for high-security environments
• Off: Disable individual protection layers

WHAT IT CATCHES:
• Invisible and near-invisible click overlays
• Viewport-covering interactive layers
• Intent-mismatch retargeting (you click X, it triggers Y)
• Unauthorized window.open() and popunders
• Cross-site redirect chains
• Location.assign/replace abuse
• Form submission to unexpected destinations
• Punycode and mixed-script domain spoofing
• Brand lookalike domains (42 brands monitored)
• Password paste on untrusted domains
• HTTP credential submission

Built with TypeScript, Chrome Manifest V3, and Vite.
Open source: github.com/Chris0Jeky/NavSentinel
```

**Screenshots needed** (1280x800 or 640x400):
1. Popup showing active protection with recent events
2. Credential modal blocking a suspicious form submission
3. Options/Control panel — analytics dashboard
4. Toast notification showing a blocked navigation
5. Debug overlay (for technical audience)

**Category**: Privacy & Security
**Language**: English

---

## 7. Content Library

### Feature Descriptions (Short)

| Feature | Short Description |
|---------|------------------|
| Click Deception Score (CDS) | Scores every click target for overlay deception — invisible elements, viewport-covering layers, retargeted interactions |
| Navigation Risk Score (NRS) | Layers behavioral context onto CDS — new-tab opens, cross-site destinations, suspicious timing, multi-attempt gestures |
| Credential Risk Score | Evaluates password form destinations for phishing signals — HTTP, lookalikes, IP addresses, cross-site actions |
| Smart/Strict Modes | Two sensitivity levels per protection axis. Smart for daily use, Strict for adversarial environments |
| Trusted Domains | User-curated list of domains approved for credential submission. Normalized to registrable domain level |
| Navigation Allowlist | Per-site destination approvals. "From site A, allow navigation to site B" |
| Rollback & Recovery | Automatic rollback of suspicious redirects with a "proceed anyway" option |
| MessagePort Bridge | Secure communication between isolated and main worlds using cryptographic session IDs — not spoofable via window.postMessage |
| Gesture Tokens | Time-bounded interaction windows (800-1500ms) that gate high-risk browser primitives |
| Event Log | Bounded local activity log with structured reason codes, exportable as JSON |
| Prompt Telemetry | Local-only statistics on prompt outcomes (allow/block/trust/dismiss rates) |
| Debug Overlay | On-page technical display showing live CDS, NRS, decision data, and element analysis |
| The Gym | 78 deterministic test fixtures simulating real attack patterns for verification |
| Public Suffix List | Embedded PSL trie for accurate domain-to-registrable-domain extraction |
| Homoglyph Detection | Confusable character normalization (rn→m, vv→w, 0→o, etc.) for brand lookalike catching |
| Brand Monitoring | 42 major brands checked for domain impersonation via edit distance, homoglyphs, and keyword matching |

### Feature Descriptions (Long — for landing page)

**The Click Deception Score**
Every time you click something on a webpage, NavSentinel analyzes the element you're clicking on. Is it invisible? Is it covering most of the screen? Is there a more meaningful element underneath it? Was your click retargeted to a different element? Each of these signals contributes to a Click Deception Score (CDS) on a 0-100 scale. Legitimate UI elements score near zero. Deceptive overlays light up like a Christmas tree.

**The Navigation Risk Score**
A high CDS means the click target is suspicious, but context matters. NavSentinel layers on navigation context to produce a Navigation Risk Score (NRS): Is this opening a new tab? Is it going to a different domain? Did it happen suspiciously fast? Are there multiple attempts in the same gesture? Did you explicitly intend to open a new tab? The NRS determines the final decision: allow, prompt, or block.

**Credential Guard**
When you're about to submit a form containing a password, NavSentinel evaluates the submission. Is the page using HTTPS? Is the form action pointing to a different domain? Does the destination look like a known brand but with slightly different characters? Is the hostname an IP address instead of a domain name? Each risk factor adds to a credential risk score that determines whether to warn you before your password leaves the browser.

**The Bridge**
Chrome extensions run in two worlds: the "isolated world" (where extension code is protected from the page) and the "main world" (where the actual webpage lives). NavSentinel needs to operate in both — it patches browser APIs like window.open in the main world, but makes decisions in the isolated world. The two communicate through a MessagePort bridge with a cryptographic session ID, making the channel invisible and unspoofable by page scripts. This is a solved problem that most extensions get wrong.

**Rollback**
When NavSentinel detects a suspicious redirect after it's already committed (the page has already changed), it doesn't just warn you — it rolls you back to where you were. Then it offers you a "proceed" button in case the redirect was legitimate. The rollback system includes loop suppression (so an attacker can't redirect you again immediately) and forward-offer persistence (so you can still reach the destination if you choose to).

---

## 8. Architecture & Technical Storytelling

### For the "How It Works" section — narrative version

**The Four Layers of Defense**

NavSentinel operates as four cooperating runtime layers inside your browser:

**Layer 1: The Watcher (Isolated World)**
The `capture_isolated` content script runs in Chrome's sandboxed isolated world. It can see the page's DOM but the page can't see it. When you click anything, it captures a rich snapshot: the element's position, size, opacity, z-index, accessible name, whether it's covering other elements, and what's underneath it. This snapshot feeds the Click Deception Score.

**Layer 2: The Guard (Main World)**
The `main_guard` script runs in the page's own execution context — the only place where you can actually intercept `window.open()`, `location.assign()`, and `form.submit()`. It patches these browser primitives at the prototype level, wrapping them in gesture-gated checks. Every navigation attempt needs a valid gesture token from the Watcher, delivered through a private MessagePort channel.

**Layer 3: The Credential Inspector (Isolated World)**
The `credential_guard` monitors password fields independently. When a form with a password input is submitted, it evaluates the destination domain against a battery of phishing heuristics: HTTPS status, domain similarity to trusted brands, hostname characteristics (IP, punycode, mixed scripts), and the user's trusted domain list. If the risk is above threshold, it throws up a modal asking the user to verify.

**Layer 4: The Coordinator (Service Worker)**
The MV3 service worker manages tab-scoped state: gesture allowances, rollback targets, typed-URL detection, and forward offers. It's the traffic controller that prevents double-spending of gesture tokens, handles rollback loops, and ensures that state is cleaned up when tabs close.

### Technical Details That Make Good Visuals

- **Gesture token lifecycle**: Pointer down → token minted → 800ms window → navigation allowed or blocked → token consumed. Visualize as a timeline.
- **CDS signal waterfall**: Stack of weighted signals building up to a score. Visualize as a horizontal bar chart where each signal adds length.
- **Rollback flow**: User clicks → redirect happens → NavSentinel detects → rolls back → offers forward. Visualize as a flowchart with the user at the decision point.
- **Domain risk decomposition**: Breakdown of a suspicious domain showing each risk factor. Visualize as an annotated URL with callouts.
- **Bridge handshake**: Two worlds, one MessagePort, cryptographic session. Visualize as a diagram with the channel between them.

---

## 9. Stats, Numbers & Proof Points

### Hard Numbers from the Codebase

| Metric | Value |
|--------|-------|
| Lines of TypeScript | ~5,573 |
| Content scripts | 3 (isolated nav, main world, isolated credential) |
| Scoring signals (CDS) | 13 positive + 2 negative factors |
| Navigation context factors (NRS) | 7 weighted factors |
| Credential risk codes | 14 distinct signals |
| Brands monitored for lookalikes | 42 |
| Gym test fixtures | 78 (12 levels + 11 evasion + 55 real-world) |
| Attack waves covered | 5 (search deception, auth laundering, commerce abuse, document/media abuse, worker-state abuse) |
| Storage keys | 5 (settings, trusted domains, allowlist, event log, prompt outcomes) |
| Confusable character mappings | 8 (rn→m, vv→w, 0→o, 1→l, !→l, \|→l, 5→s, 8→b) |
| Gesture token TTL | 800ms (open) / 1500ms (redirect) |
| Event log capacity | 50-5000 entries (configurable ring buffer) |
| Event types tracked | 11 |
| Chrome permissions | 3 (storage, webNavigation, tabs) |
| Source files | 21 TypeScript + 2 HTML + 2 CSS |
| Build tool | Vite 5.4 + @crxjs/vite-plugin |
| Test frameworks | Vitest + Playwright + fast-check |
| Roadmap phases | 5 (Stabilize ✓, Validate Foundation, Target Threats, Productize, Differentiate) |
| Roadmap tasks | 41 total |

### Impressive Comparisons

- "13 deception signals analyzed on every click — in under 1ms"
- "42 brands monitored for lookalike domain attacks"
- "78 attack simulations in the Gym — from basic overlays to complex multi-hop redirect chains"
- "Zero bytes sent to any server. Ever."
- "3-tier scoring system: element → navigation → decision"
- "800ms — the gesture window that separates your intent from an attacker's script"

---

## 10. Visual Direction & Mood

### Overall Aesthetic
- **Dark mode primary**. Deep navy/charcoal backgrounds (#0d1117 to #161b22 range)
- **Terminal/hacker aesthetic** meets modern UI. Think GitHub's dark mode + Vercel's design language + a security operations center
- **Monospace for data**, sans-serif for UI labels
- **Glassmorphism** for cards and panels (subtle, not overdone)
- **Accent colors**: Cyan (#8ed2ff) for navigation, Green (#71e6b4) for credential/trust, Orange (#ffd166) for warnings, Red (#ff6b6b) for blocks
- **Grid/matrix motifs** in backgrounds (subtle dot grid, scan lines, or circuit patterns)
- **Code snippets** as decorative elements (show actual scoring logic, reason codes)
- **No stock photos**. Diagrams, code, data visualizations, UI screenshots

### Mood References
- GitHub's Copilot marketing pages (dark, technical, visual)
- Warp terminal's website (dark, sleek, developer-focused)
- CrowdStrike/SentinelOne product pages (security aesthetic, but less corporate)
- Tailwind CSS documentation (clean, well-organized, technical)
- Excalidraw's hand-drawn diagram style (for architecture diagrams)

### Color Palette

```
Background:     #0d1117 (deep navy)
Surface:        #161b22 (card background)
Surface hover:  #1c2128
Border:         #30363d
Text primary:   #e6edf3
Text secondary: #8b949e
Text muted:     #484f58

Cyan accent:    #8ed2ff (navigation)
Green accent:   #71e6b4 (credential/trust)
Orange accent:  #ffd166 (warning)
Red accent:     #ff6b6b (block/danger)
Purple accent:  #bc8cff (optional, for special highlights)

Gradient:       #8ed2ff → #71e6b4 (primary CTA gradient)
```

### Typography Suggestions
- **Display/Hero**: Inter, Space Grotesk, or JetBrains Mono
- **Body**: Inter or system sans-serif stack
- **Code/Data**: JetBrains Mono, Fira Code, or Source Code Pro

---

## 11. Current State Reference

### Current Popup (existing design notes)
- 372px wide
- Dark navy gradient background
- "NS" logo mark (48x48 rounded square)
- "NavSentinel Suite" header with version tag
- Current site display in monospace
- Trust status pill (green/orange/gray)
- Two dropdown controls: nav mode + cred mode
- Trust/Untrust action buttons
- Recent events section (up to 6 cards)
- Events color-coded by type (nav=cyan, cred=green, config=orange)
- Footer: "Local log only. Nothing leaves the browser."

### Current Options Page (existing design notes)
- Light theme (white/light blue gradient) — **should move to dark theme**
- Max width 1100px
- Sections: Nav Protection, Cred Protection, Prompt Statistics, Event Log, Nav Exceptions, Cred Exceptions
- Clean professional UI but lacks visual flair
- "Save settings" sticky footer with hint text

### Current Modal (credential prompt)
- Dark overlay (rgba 0,0,0,0.55)
- Dark modal card, max 760px wide
- "Credential submit blocked" title
- Key-value display: Page, Destination, Risk score with severity
- Signal list as bullet points
- Action buttons: Cancel (red), Proceed once (blue), Trust domain (conditional)

### Current Toast Notifications
- Bottom-right, 360px wide
- Dark semi-transparent
- Auto-dismiss after 4 seconds
- Messages like "NavSentinel blocked deceptive click (NRS=72, CDS=55)"

---

## 12. Operational Prompts for Claude Design

### Prompt 1: Landing Page
```
Design a single-page product landing page for NavSentinel, a local-first Chrome
extension that detects deceptive navigation and credential phishing.

Audience: Security-conscious developers, privacy enthusiasts, infosec professionals.
Tone: Technical but accessible. Not corporate. Think open-source security tool.
Aesthetic: Dark theme (navy #0d1117), terminal/hacker meets modern UI, glassmorphism
cards, monospace for data, accent colors cyan/green/orange/red.

Sections needed:
1. Hero with tagline "Catches what Safe Browsing can't see" + install/github CTAs
2. "What It Catches" — 6 attack categories in a grid with icons
3. "How It Works" — Architecture diagram showing 4 runtime layers
4. "Scoring System" — Visual breakdown of CDS → NRS → Decision pipeline
5. "What Makes It Different" — Comparison table vs traditional extensions
6. "Privacy by Architecture" — Zero telemetry proof points
7. "The Gym" — 78 test fixtures showcase
8. "Roadmap" — Coming soon features (DoubleClickjacking detection headline)
9. Footer with GitHub link and "No tracking. No telemetry. Just math."

Include: code snippets as decorative elements, data visualizations for scoring,
architecture diagrams, subtle grid/circuit background patterns.
Do NOT include: stock photos, corporate feel, pricing sections, testimonial sections.
```

### Prompt 2: Extension Popup
```
Design a Chrome extension popup (372px wide) for NavSentinel, a browser security tool.
It should feel like a compact mission control panel / fighter-jet HUD.

Dark theme: background #0d1117, cards #161b22, text #e6edf3.
Accents: cyan #8ed2ff (navigation), green #71e6b4 (credential/trust),
orange #ffd166 (warning), red #ff6b6b (block).

Layout (top to bottom):
1. Compact header: logo mark + current hostname (monospace) + trust status dot
2. Protection strip: two segmented controls (Nav: Off/Smart/Strict, Cred: Off/Smart/Strict)
3. Current page assessment: risk level, event count, active signals as chips
4. Activity feed: 5-6 event cards with icon, type, relative timestamp, brief detail,
   color-coded left border by severity
5. Quick actions: Trust/Untrust toggle + "Open dashboard" link
6. Footer: "Everything stays local" in muted text

Style: Glassmorphism cards, monospace for scores/hostnames, small-caps labels,
subtle scan-line or dot-grid texture in background.
```

### Prompt 3: Options / Control Panel
```
Design a full-page options/control panel for NavSentinel Chrome extension.
Should feel like a security operations dashboard — Grafana meets VS Code settings.

Dark theme matching the popup. Sidebar navigation on the left.

Panels:
1. Protection Settings — Two cards (Navigation Firewall, Credential Guard) with
   mode selectors, toggles, threshold sliders with visual indicators
2. Threat Analytics — Prompt outcome donut chart, risk score histogram,
   top domains table, signal frequency bar chart, stat cards
3. Event Log — Filterable list with type/severity/domain filters, expandable entries,
   export/import/clear buttons, log capacity indicator
4. Trust Management — Navigation allowlist table + credential trusted domains list
   with add/remove controls
5. Import/Export — Configuration portability with JSON preview

Include data visualization components (charts, graphs) using the accent color palette.
Monospace for all technical values. Responsive but desktop-optimized (max 1100px content).
```

### Prompt 4: Chrome Web Store Promotional Graphics
```
Design Chrome Web Store promotional screenshots (1280x800) for NavSentinel.
Dark theme, matching the extension's aesthetic.

Screenshots needed:
1. Popup in action — showing active protection with recent events on a website
2. Credential modal — blocking a suspicious password form submission
3. Control panel dashboard — analytics view with charts and stats
4. Toast notification — blocking a deceptive click, shown on a webpage
5. The Gym — test fixture grid or a test running with debug overlay visible

Each screenshot should have:
- A subtle browser chrome frame
- A descriptive caption overlay at the bottom
- The NavSentinel accent color palette
- Clean, readable text at Web Store thumbnail size

Also design a promotional tile (1400x560) with:
- NavSentinel logo
- Tagline: "Catches what Safe Browsing can't see"
- 3-4 key feature icons
- Dark theme with cyan/green gradient accent
```

### Workflow Notes for Claude Design Sessions

1. **Start with the popup** — it's the most constrained surface (372px) and establishes the visual language that everything else follows.
2. **Then the landing page** — it's the most creative surface and can expand on the popup's design language.
3. **Then the options panel** — it reuses components from both popup and landing page.
4. **Finally the store graphics** — these are compositions of the other surfaces.

For each surface, iterate in this order:
1. Layout/wireframe first (structure and information hierarchy)
2. Visual treatment (colors, typography, effects)
3. Content population (real copy from this brief)
4. Responsive/edge cases (long hostnames, many events, empty states)

---

## Appendix A: All Event Types

| Event Kind | Category | Description |
|-----------|----------|-------------|
| `nav_blank_prompt` | Navigation | User prompted about a _blank navigation |
| `nav_click_block` | Navigation | Click blocked by NRS threshold |
| `nav_rollback` | Navigation | Redirect rolled back to previous page |
| `nav_allowlist_add` | Navigation | User added a site→destination to allowlist |
| `nav_allowlist_remove` | Navigation | User removed an allowlist entry |
| `cred_submit_prompt` | Credential | User prompted before password submission |
| `cred_submit_allow_once` | Credential | User allowed one-time credential submission |
| `cred_trust_domain` | Credential | User trusted a domain for credential submission |
| `cred_untrust_domain` | Credential | User removed a domain from trusted list |
| `cred_paste_warn` | Credential | User warned about pasting into password field |
| `suite_config_update` | Config | User changed extension settings |

## Appendix B: All CDS Reason Codes

| Code | Signal |
|------|--------|
| `no_accessible_name` | Interactive element without accessible name (+15) |
| `minimal_accessible_name` | Accessible name 1-3 characters (+8) |
| `overlay_large_interactive` | Covers >35% viewport (+30) |
| `overlay_medium_interactive` | Covers 20-35% viewport (+1-20 graduated) |
| `intent_mismatch_under_interactive` | More intentful element underneath (+35) |
| `retargeted_target_mismatch` | Click retargeted to different element (+20) |
| `overlay_high_zindex` | z-index ≥ 9999 on fixed/absolute element (+15) |
| `overlay_elevated_zindex` | z-index 5000-9999 on fixed/absolute (+1-10 graduated) |
| `invisible_but_clickable` | Opacity < 0.08 or display:none with clicks (+25) |
| `near_invisible_opacity` | Opacity 0.08-0.15 (+8-15 graduated) |
| `low_opacity` | Opacity 0.15-0.3 (+0-8 graduated) |
| `cursor_pointer_no_affordance` | Pointer cursor without visible button/link styling (+10) |
| `composite_escalation` | 3+ signals: +10, 4+ signals: +15 |
| `keyboard_activation` | User activated via keyboard (-10 mitigation) |
| `legit_modal_backdrop` | Legitimate modal backdrop pattern (-20 mitigation) |

## Appendix C: All Credential Risk Codes

| Code | Signal | Weight |
|------|--------|--------|
| `non_https_page` | Page loaded over HTTP | +55 |
| `non_https_action` | Form submits over HTTP | +45 |
| `userinfo_in_url` | URL contains user@ prefix | +35 |
| `ip_hostname` | Hostname is IP address | +35 |
| `punycode_hostname` | Hostname uses xn-- encoding | +25 |
| `mixed_script_hostname` | Hostname mixes Latin + Cyrillic/Greek | +25 |
| `deep_subdomain` | More than 2 subdomain levels | +10 |
| `cross_site_action` | Form action on different domain | +18 |
| `cross_site_to_trusted` | Cross-site but destination is trusted | +5 |
| `lookalike_domain` | Domain within Levenshtein distance ≤2 of trusted | +45 |
| `homoglyph_lookalike` | Homoglyph-normalized similarity match | +45 |
| `brand_keyword` | Known brand name embedded in domain | +40 |
| `subdomain_stuffing` | Brand name as subdomain of untrusted domain | +35 |
| `untrusted_domain` | Domain not in user's trust list | +10 |

## Appendix D: File Map

```
extension/src/
├── content/
│   ├── capture_isolated.ts    893 lines  Click/nav event capture + CDS/NRS
│   ├── main_guard.ts          736 lines  Main-world API patching
│   ├── credential_guard.ts    271 lines  Password field monitoring
│   ├── credential_guard_model.ts 58 lines  Credential risk helpers
│   ├── credential_modal.ts    231 lines  Credential prompt modal UI
│   ├── dom_builder.ts         195 lines  DOM element analysis
│   ├── debug_overlay.ts       114 lines  Developer debug panel
│   └── ui_toast.ts            125 lines  Toast notification system
├── shared/
│   ├── types.ts                47 lines  Core type definitions
│   ├── storage.ts             423 lines  Chrome storage wrapper
│   ├── scoring.ts             214 lines  CDS computation
│   ├── nrs.ts                  78 lines  NRS computation
│   ├── allowlist.ts            98 lines  Navigation allowlist
│   ├── domain.ts              793 lines  Domain analysis + PSL
│   ├── event_tone.ts           10 lines  Event classification
│   └── stateMachine.ts         40 lines  Gesture token state
├── popup/
│   ├── popup.ts               317 lines  Popup controller
│   ├── popup.html              90 lines  Popup layout
│   ├── popup.css              373 lines  Popup styling
│   └── popup_model.ts          51 lines  UI state derivation
├── options/
│   ├── options.ts             469 lines  Options controller
│   ├── options.html           279 lines  Options layout
│   └── options.css            509 lines  Options styling
└── sw/
    └── sw.ts                  379 lines  Service worker
```

**Total: ~5,573 lines TypeScript | ~369 lines HTML | ~882 lines CSS**
