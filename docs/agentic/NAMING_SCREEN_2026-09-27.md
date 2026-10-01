# Product-name risk screen, 2026-09-27 (AI-19)

**Classification: a web-based risk screen, not legal clearance.** The screen
could not open USPTO, EUIPO, WIPO or UK IPO directly; those pages returned 403
or were not checked. Trademark signals come from search snippets only.
The Chrome Web Store redirected to a consent page, which was not accepted, so
extension clashes came from web search plus the public Firefox add-ons API.
Domain status came from registry RDAP lookups. A formal clearance search in
classes 9 and 42 (and 45 if services are offered), plus professional advice,
is still required before a store submission or commercial launch.

## Why rename

- TruNav publicly uses the exact name `NavSentinel` for a GNSS anti-spoofing
  receiver (AI-19).
- "Nav" is too narrow. The product now guards credential submits, clipboard
  traps (ClickFix), double-click attacks and overlays as well as navigation.

## What the name has to carry

These criteria come from `docs/Product_Strategy.md` and the design brief:

- a calm, explainable check at the moment a page turns a click into a
  consequence;
- local-first and open-source, with no fear-marketing. Measured quietness is a
  product value;
- room to grow into interaction integrity and evidence services;
- distinctive enough to protect as a trademark, and pronounceable, spellable
  and searchable.

## Results

| Name | Risk | Main finding |
| --- | --- | --- |
| **Heedline** | **LOW** | No extension or software/security namesake found. `.app` and `.dev` are unregistered. `.com` was registered 2025-09-08 and shows no site, purpose unknown. It can sound like "headline". |
| TrueBearing | LOW | Consulting and finance firms only; no software use. Keeps a navigation flavour. All main domains are taken. |
| Watchword | LOW | A discontinued Mac password app; a UK guarding firm. Common word, weak for search. `.app` and `.dev` were registered in 2026. |
| Fingerpost | LOW | A London news-software firm since 1985, and a computer-vision product on `.dev`. Mostly British. Close to "fingerprinting". |
| Vedette | LOW | No software namesake. Means "star" or "showgirl" in French and Spanish. All domains taken. |
| Picquet | LOW | No software namesake. Hard to pronounce and spell; searches reroute to Picus Security. |
| Intentry | MEDIUM | `intentry.dev` is a live developer tool (version control for AI prompts). |
| Plumbline | MEDIUM | A software consultancy, plus a small agent-security tool with a close concept. |
| Picket | MEDIUM | "Picket Line" Chrome extensions; Picket API; strike connotation. |
| Lookfirst | MEDIUM | LookFirst Technology offers managed IT with security monitoring. |
| Belay | MEDIUM | Belay Technologies lists cyber-security solutions; BELAY Solutions; USPTO filings. |
| Waymark | HIGH | Several funded software companies, one with a Chrome extension. |
| Telltale | HIGH | Kryptos Logic "Telltale" threat intelligence; Telltale Games. |
| Heedful | HIGH | A live privacy/AI-paste Chrome extension in the same space. |
| Custos | HIGH | Many security products (Apache Custos and others). |
| Keel | HIGH | Klas "Keel" (NIAP/CSfC security product); a Keel browser extension. |
| Intentwise | HIGH | Intentwise Inc., commerce analytics software since 2016. |
| Tripline | HIGH | Nebulon TripLine ransomware detection; close to Tripwire. |

## Decision

On 2026-09-27 Chris chose **Heedline**, with the rename limited to
user-facing surfaces (D-2026-09-27-T). Rerun the formal searches before relying
on this table.

## Sources consulted (2026-09-27)

- Registry lookups:
  - `https://rdap.verisign.com/com/v1/domain/<name>.com`
  - `https://pubapi.registry.google/rdap/domain/<name>.app` (and `.dev`)
- Firefox add-ons: `https://addons.mozilla.org/api/v5/addons/search/?q=<name>`
- Heedline: `https://bsky.app/profile/heedline.bsky.social` (an unrelated
  social handle); no product found.
- Heedful: `https://heedful.app/`
- Intentry: `https://intentry.dev`
- Intentwise: `https://www.intentwise.com/`
- Telltale: `https://www.kryptoslogic.com/products/telltale/`
- Waymark:
  - `https://waymark.com`
  - `https://chromewebstore.google.com/detail/studio-extension/gpbcmgoholfjgjfknpacmfgaadfpgaob`
- Keel: `https://www.klasgroup.com/keel/`, `https://www.keelsystem.online/`
- Custos: `https://airavata.apache.org/custos/`
- Tripline: `https://www.csoonline.com/article/575265/nebulons-tripline-offers-ransomware-encryption-protection-for-on-prem-systems.html`
- Belay: `https://www.belaytech.com/`, `https://belaysolutions.com/our-company`
- Plumbline: `https://www.linkedin.com/company/plumbline-consulting`,
  `https://github.com/askalf/plumbline`
- Picket:
  - `https://chromewebstore.google.com/detail/picket-line/ghpdnccbehomkkafcepmloidmdpmchah`
  - `https://docs.picketapi.com/picket-docs`
- Lookfirst: `https://www.linkedin.com/company/lookfirst-technology-llc`
- Fingerpost: `https://www.fingerpost.co.uk/wp/`
- Watchword: `http://www.watchwordapp.com/`
- TrueBearing: `https://www.linkedin.com/company/truebearing`
- Vedette: `https://www.vedettesecurity.uk/company`,
  `https://www.groupebrandt.com/our-brands/vedette/`
