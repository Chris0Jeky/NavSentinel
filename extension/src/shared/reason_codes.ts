/**
 * Whether a reason code reduces risk rather than signals a threat.
 *
 * Keep this classification shared by the popup signal chips and content-script
 * warning toasts so those surfaces cannot drift apart.
 */
export function isRiskReducingReason(reasonCode: string): boolean {
  const r = reasonCode ?? "";
  return (
    r.startsWith("keyboard_") ||
    r.startsWith("legit_") ||
    r.includes("allowlisted") ||
    r.includes("previously_allowed") ||
    r.includes("explicit_new_tab") ||
    r === "nrs_user_activation_active"
  );
}
