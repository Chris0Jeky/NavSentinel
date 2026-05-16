# NavSentinel — Screenshot Plan for Chrome Web Store

CWS requires 1-5 screenshots at 1280x800 or 640x400.

## Screenshot List

### 1. Popup — Smart Mode Active (hero shot)
- URL: any site (e.g., github.com)
- Popup open showing: NavSentinel title, current site domain, "Trusted" pill, Smart mode selected, recent events
- Shows the extension is active and monitoring

### 2. Toast — Navigation Blocked
- Gym page: `level1-basic-opacity.html` or `rw01-search-result-overlay-swap.html`
- Trigger the attack scenario
- Capture the red "Blocked" toast with "Allow once" and "Dismiss" buttons
- Shows the extension catching a real attack

### 3. Toast — Credential Warning
- Gym page: `level11-credential-guard.html`
- Submit credentials to a suspicious domain
- Capture the credential risk modal with score, reason codes, and action buttons
- Shows credential protection in action

### 4. Options — Dashboard View
- Open the options page
- Show: mode selectors, trusted domain list, event log with entries, allowlist
- Shows the full control surface

### 5. Onboarding — Welcome Page
- Open `src/onboarding/onboarding.html`
- Shows the first-install experience with detection layer cards

## Capture Commands

```bash
# Record the showcase demo which visits key pages
npm run demo:showcase:record

# Or manually with Playwright
npx playwright screenshot --full-page extension/dist/src/popup/popup.html popup.png
```

## Promotional Tile (440x280)
- NavSentinel logo + tagline: "Catches what Safe Browsing can't see"
- Dark theme matching extension aesthetic

## Notes
- All screenshots should be taken with the dark theme (extension default)
- Include the browser chrome to show this is a real extension
- Gym scenarios provide reproducible attack demonstrations
