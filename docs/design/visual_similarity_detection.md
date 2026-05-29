# P4-01: Visual Similarity Detection — Architecture Design

## Problem Statement

Phishing pages that perfectly replicate a brand's login UI (pixel-identical HTML/CSS) can
evade URL-based and DOM-structure-based detection. A visual similarity check compares what
the user *sees* against known brand login templates, catching copy-paste phishing kits
regardless of domain, URL path, or HTML structure.

## Constraints

| Constraint | Requirement |
|-----------|-------------|
| Runtime | Client-side only (no server round-trips) |
| Performance | < 50ms capture + hash; < 10ms per comparison |
| Privacy | No screenshots leave the device; no network calls |
| Storage | Template DB fits in extension storage (< 500 KB) |
| Activation | Only triggered on pages with credential fields |
| False positives | Must not flag legitimate brand login pages |

## Chosen Approach: Average Hash + Block Mean Hash (Two-Pass)

### Why not pHash (DCT-based)?

- DCT computation is expensive (O(n^2) for NxN block) in pure JS
- Requires floating-point precision that varies across platforms
- Library implementations (phash.js) are large (~30 KB) and unmaintained

### Why not neural/ML approaches?

- Model size would exceed extension storage budget
- Inference latency too high for synchronous page analysis
- Over-engineered for the initial version

### Chosen: Average Hash (fast reject) + Block Mean Hash (confirm)

**Pass 1 — Average Hash (aHash):**
- Resize screenshot to 8x8 grayscale
- Compare each pixel to the mean brightness
- Output: 64-bit hash (8 bytes)
- Comparison: Hamming distance (XOR + popcount)
- Threshold: distance <= 10 → candidate match
- Cost: ~5ms capture + 1ms hash

**Pass 2 — Block Mean Hash (bHash):**
- Resize to 16x16, compute mean of each 4x4 block
- 256-bit hash (32 bytes) with finer spatial detail
- Only computed on aHash candidates (lazy)
- Threshold: distance <= 25 → confirmed match
- Cost: ~15ms (only runs on suspects)

### Alternative considered: dHash (gradient hash)

- Compares adjacent pixel brightness
- Good at detecting structural changes but over-sensitive to color shifts
- Phishing kits often use slightly different brand colors
- Would cause false negatives on color-shifted clones

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Content Script (Isolated World)                      │
│                                                      │
│  credential_guard detects password field              │
│         │                                            │
│         ▼                                            │
│  visual_sim_capture.ts                               │
│    1. Wait 500ms after page stable (no mutations)    │
│    2. Capture viewport via OffscreenCanvas            │
│    3. Resize to 8x8 grayscale → aHash               │
│    4. Compare against template DB (aHash pass)       │
│    5. If candidate: resize 16x16 → bHash confirm    │
│    6. If match: emit NRS signal                      │
│                                                      │
│  visual_sim_templates.ts                             │
│    - Pre-computed aHash + bHash for known brands     │
│    - Stored in extension storage (chrome.storage)    │
│    - ~20 bytes per brand × 50 brands = 1 KB         │
│                                                      │
└──────────────────────────────────────────────────────┘
         │ NRS signal
         ▼
┌──────────────────────────────────────────────────────┐
│  NRS (nrs.ts)                                        │
│    visualSimilarityScore: 0-30                       │
│    Factor: nrs_visual_brand_match                    │
└──────────────────────────────────────────────────────┘
```

## Capture Strategy

### When to capture:
1. Page has `input[type="password"]` visible in viewport
2. Page has been visually stable for 500ms (no layout shifts, no mutations)
3. Extension mode is not "off"
4. Page is not in the allowlist

### How to capture:
- Use `html2canvas` or native canvas API via `OffscreenCanvas`
- Capture only the visible viewport (not full page)
- Immediate downsample to 8x8 (no high-res screenshot ever stored)
- The 8x8 grayscale image is ephemeral — discarded after hashing

### Privacy guarantee:
- No pixel data leaves the content script
- Only 8-byte / 32-byte hashes are retained temporarily
- Hash is not stored, logged, or sent anywhere
- Template comparison happens in-memory, synchronously

## Template Database

### Initial brand set (50 brands):

| Category | Brands |
|----------|--------|
| Email | Google, Microsoft (Outlook/Live), Yahoo, ProtonMail |
| Social | Facebook, Twitter/X, Instagram, LinkedIn, TikTok |
| Banking | Chase, Bank of America, Wells Fargo, Citi, Capital One, HSBC, Barclays |
| E-commerce | Amazon, eBay, PayPal, Stripe (checkout) |
| Cloud | AWS Console, Azure, GCP, Cloudflare, DigitalOcean |
| Crypto | Coinbase, Binance, Kraken, MetaMask |
| Dev | GitHub, GitLab, Bitbucket, npm |
| Enterprise | Salesforce, Okta, Duo, Workday |
| Telecom | AT&T, Verizon, T-Mobile |
| Streaming | Netflix, Spotify, Apple (iCloud) |
| Misc | Dropbox, Zoom, Slack, Discord |

### Template generation:
- Screenshot each brand's login page at 1920x1080
- Compute aHash and bHash
- Store only the hashes (not the screenshots)
- Re-generate periodically as brands update their UIs
- Ship as a JSON file bundled with the extension

### Template format:
```typescript
interface BrandTemplate {
  id: string;          // "google", "github", etc.
  displayName: string; // "Google Sign-In"
  aHash: Uint8Array;   // 8 bytes
  bHash: Uint8Array;   // 32 bytes
  version: number;     // template revision
}
```

## NRS Integration

```typescript
// In NavigationContext:
visualSimilarityScore?: number; // 0-30

// Weight:
const NRS_WEIGHT_VISUAL_SIM_CAP = 30;

// Logic:
if (navCtx.visualSimilarityScore && navCtx.visualSimilarityScore > 0) {
  nrs += Math.min(navCtx.visualSimilarityScore, NRS_WEIGHT_VISUAL_SIM_CAP);
  nrsFactors.push("nrs_visual_brand_match");
}
```

### Score calculation:

A visual brand match only contributes risk when the page impersonates a brand
on a **non-canonical (cross-origin) domain**. A brand login rendered on the
brand's own canonical domain is legitimate and **scores 0** — this avoids
false positives where a real login would otherwise stack toward a block
(e.g. new-tab + cross-site + fast click).

- On-canonical-domain match (any confidence): **0** (legitimate, never contributes)
- Cross-origin from brand domain, aHash-only (bHash fails): **+10**
  (deliberately weak signal — aHash is coarse 8x8 and matches loosely)
- Cross-origin from brand domain, bHash-confirmed: **+30** (maximum)

The two-pass flow first runs with the cross-origin flag false to learn *which*
brand matched (the match object is populated even though the score is 0), looks
up that brand's canonical domain, and only then re-scores with the cross-origin
flag set when the current page is off the canonical domain. The screenshot,
hashes, and match are cached by URL so the second pass only re-scores (no
re-capture).

## Performance Budget

| Operation | Budget | Actual (estimated) |
|-----------|--------|-------------------|
| Detect password field | 0ms | Existing credential_guard |
| Wait for stability | 500ms | MutationObserver debounce |
| Capture viewport | 20ms | OffscreenCanvas drawImage |
| Resize to 8x8 | 2ms | Canvas scale |
| Compute aHash | 1ms | getImageData + threshold |
| Compare 50 aHashes | 1ms | Hamming distance loop |
| Resize to 16x16 (if needed) | 5ms | Canvas scale |
| Compute bHash | 3ms | Block mean calculation |
| Compare bHash | 0.1ms | Single Hamming distance |
| **Total (no match)** | **~525ms** | Dominated by stability wait |
| **Total (with match)** | **~535ms** | +10ms for bHash path |

## File Structure

```
extension/src/
├── shared/
│   ├── visual_sim_hash.ts     # aHash + bHash algorithms
│   ├── visual_sim_templates.ts # Template DB loader + comparison
│   └── visual_sim_types.ts    # Shared types
├── content/
│   └── visual_sim_capture.ts  # Viewport capture + trigger logic
└── assets/
    └── brand_templates.json   # Pre-computed hash database
```

## Implementation Phases

| Phase | Deliverable | Branch |
|-------|-------------|--------|
| W3-01 | This design doc + stub interfaces | `feat/visual-sim-research` |
| W3-02 | Hash algorithms + capture pipeline | `feat/visual-sim-capture` |
| W3-03 | Brand template database | `feat/visual-sim-templates` |
| W3-04 | NRS integration + scoring | `feat/visual-sim-scoring` |
| W3-05 | Gym fixtures + E2E tests | `test/visual-sim-gym` |

## Open Questions

1. **OffscreenCanvas availability**: Content scripts in MV3 may not have access.
   Fallback: use `chrome.tabs.captureVisibleTab()` from the service worker (requires
   `activeTab` permission, already granted).

2. **Dark mode handling**: Brand login pages look different in dark mode. Should we store
   both light/dark templates, or normalize to grayscale before hashing? (Answer: grayscale
   normalization handles this — both modes produce similar structure in grayscale.)

3. **SPA login pages**: Some logins load in stages (Google shows email first, then password).
   The capture triggers on password field visibility, so it will see the final state.
   In-page (SPA) navigations — popstate, hashchange, and pushState/replaceState
   route changes — reset the cached per-route score and re-run the check for the
   new route, so a score from one route never leaks into another.

4. **Template staleness**: Brands update their UIs. Ship updates with extension versions.
   Stale templates won't cause false positives (they just won't match), only missed detections.

## Security Considerations

- Template hashes are public (derived from publicly accessible login pages)
- Cannot reverse a hash back to a screenshot
- Malicious pages cannot probe which brands are in the template set
  (the check only runs when a password field is present)
- No fingerprinting vector: the hash is never shared externally
