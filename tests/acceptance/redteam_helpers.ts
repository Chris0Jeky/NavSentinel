/**
 * Red-team acceptance helpers (adversarial, owner-sanctioned defensive research
 * against NavSentinel's own build on `main`). Shared, Node-side utilities only;
 * the hostile page capabilities themselves live in the redteam-* fixtures so
 * they run in the page's MAIN world exactly as a real attacker's script would.
 */

export function uniqueMarker(): string {
  return `RT${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e6).toString(36).toUpperCase()}`;
}

export type AttemptOutcome = "BLOCKED" | "REACHED-HARM" | "NOT-APPLICABLE";

export type Attempt = {
  id: string;
  technique: string;
  fixture: string;
  expected: string;
  observed: AttemptOutcome;
  finding: "NEW" | "KNOWN" | "CONTROL";
  detail?: string;
};
