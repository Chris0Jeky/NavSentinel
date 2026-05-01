/**
 * Same-organization domain groups.
 *
 * Many companies operate multiple registrable domains that belong to the
 * same organization.  When a user navigates between domains in the same
 * group (e.g. unity3d.com -> unity.com), the navigation should not be
 * penalized as cross-site.
 *
 * The list is intentionally small and auditable.  Only high-traffic
 * multi-domain ecosystems that real users encounter daily are included.
 * Each group has a brief comment explaining the relationship.
 *
 * To add a new group: append an array of registrable domains and add a
 * test case in tests/domain-groups.test.ts.
 */

import { getRegistrableDomain, normalizeHost } from "./domain";

/**
 * Each inner array is a set of registrable domains owned by the same
 * organization.  Order within a group does not matter.
 */
const DOMAIN_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  // Unity Technologies
  ["unity.com", "unity3d.com"],

  // Google / Alphabet
  ["google.com", "youtube.com", "googleapis.com", "googlevideo.com",
   "googleusercontent.com", "gstatic.com", "google.co.uk", "google.de",
   "google.fr", "google.co.jp"],

  // Microsoft
  ["microsoft.com", "live.com", "outlook.com", "bing.com", "office.com",
   "microsoftonline.com", "windows.com", "xbox.com", "skype.com",
   "linkedin.com"],

  // Amazon
  ["amazon.com", "amazonaws.com", "amazontrust.com", "amazonpay.com",
   "amazon.co.uk", "amazon.de", "amazon.co.jp"],

  // Apple
  ["apple.com", "icloud.com"],

  // Meta / Facebook
  ["facebook.com", "instagram.com", "whatsapp.com", "fb.com",
   "facebookmail.com", "meta.com"],

  // Cloudflare
  ["cloudflare.com", "cloudflareinsights.com"],

  // Mozilla
  ["mozilla.org", "firefox.com"],

  // Yahoo / Oath / Verizon Media
  ["yahoo.com", "yahoodns.net", "yahooapis.com"],

  // Adobe
  ["adobe.com", "adobelogin.com"],

  // Atlassian
  ["atlassian.com", "bitbucket.org", "trello.com"],

  // JetBrains
  ["jetbrains.com", "intellij.net"],

  // GitHub (Microsoft-owned but distinct ecosystem)
  ["github.com", "githubassets.com", "githubusercontent.com"],

  // Reddit
  ["reddit.com", "redditmedia.com", "redditstatic.com", "redditinc.com"],
];

/**
 * Reverse lookup: registrable domain -> group index.
 * Built once at module load time from DOMAIN_GROUPS.
 */
const domainToGroup: Map<string, number> = new Map();

for (let i = 0; i < DOMAIN_GROUPS.length; i++) {
  const group = DOMAIN_GROUPS[i]!;
  for (const domain of group) {
    domainToGroup.set(normalizeHost(domain), i);
  }
}

/**
 * Returns true when both domains belong to the same organization,
 * meaning cross-site penalties should not apply.
 *
 * Accepts either raw hostnames or registrable domains.  When a raw
 * hostname is passed it is reduced to its registrable domain first.
 */
export function areSameOrganization(
  domainA: string,
  domainB: string,
): boolean {
  if (!domainA || !domainB) return false;

  const regA = normalizeHost(getRegistrableDomain(domainA));
  const regB = normalizeHost(getRegistrableDomain(domainB));

  if (!regA || !regB) return false;
  if (regA === regB) return true; // trivially same-site

  const groupA = domainToGroup.get(regA);
  if (groupA === undefined) return false;

  return groupA === domainToGroup.get(regB);
}
