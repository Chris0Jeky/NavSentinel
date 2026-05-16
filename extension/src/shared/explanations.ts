const EXPLANATIONS: Record<string, string> = {
  // CDS reason codes (scoring.ts)
  no_accessible_name: "This clickable area has no visible label",
  minimal_accessible_name: "This clickable area has a very short label",
  overlay_large_interactive: "A large overlay is covering the page",
  overlay_medium_interactive: "A medium-sized overlay is covering part of the page",
  intent_mismatch_under_interactive: "This button is hidden behind another element",
  retargeted_target_mismatch: "The click target changed between press and release",
  overlay_high_zindex: "An element is layered suspiciously high above the page",
  overlay_elevated_zindex: "An element is positioned above normal page content",
  invisible_but_clickable: "An invisible element received your click",
  near_invisible_opacity: "A nearly invisible element is intercepting clicks",
  low_opacity: "A low-visibility element is intercepting clicks",
  cursor_pointer_no_affordance: "A hidden clickable element has no visible label",
  keyboard_activation: "Activated via keyboard (lower risk)",
  legit_modal_backdrop: "Standard dialog backdrop detected (lower risk)",
  composite_escalation: "Multiple suspicious signals detected together",

  // NRS factor codes (nrs.ts)
  nrs_new_tab_window: "Navigation opens a new tab or window",
  nrs_cross_site: "Navigation goes to a different website",
  nrs_fast_attempt: "Navigation triggered unusually quickly after click",
  nrs_user_activation_active: "Browser detected an active user gesture",
  nrs_multiple_attempts: "Multiple navigation attempts from a single click",
  nrs_allowlisted: "Destination is on your allowlist",
  nrs_explicit_new_tab_intent: "You explicitly opened this in a new tab",
  nrs_double_click_hijack: "A page tried to hijack your double-click",
  nrs_known_bad_domain: "Destination is a known malicious domain",
  nrs_redirect_chain_depth: "Navigation went through multiple redirects",
  nrs_redirect_via_known_redirector: "Navigation passed through a known redirect service",
  nrs_oauth_redirect_mismatch: "OAuth login redirected to an unexpected site",
  nrs_oauth_opener_manipulation: "A page manipulated the opener window during OAuth",
  nrs_clickfix_active: "Fake verification dialog detected on this page",
  nrs_opener_previously_allowed: "You previously allowed this popup source",
  nrs_pushstate_abuse: "Page manipulated its URL suspiciously after your click",
  nrs_nav_anomaly: "Unusual burst of navigations to an unfamiliar site category",
  nrs_csp_weakness: "Page has a weak Content Security Policy", // meta-tag only; cannot see HTTP-header CSP
  nrs_domain_repeat_offender: "This domain has a history of elevated risk scores",

  // ClickFix detector reason codes (clickfix_detector.ts)
  clipboard_command_with_overlay: "Clipboard was overwritten with a command while a dialog was active",
  clipboard_write_with_overlay: "Clipboard was overwritten while a dialog was active",
  clickfix_instruction_pattern: "Page contains fake verification with paste instructions",
  clickfix_paste_instruction: "Page instructs you to paste clipboard contents",
  clickfix_captcha_text_with_overlay: "Fake CAPTCHA text detected alongside a dialog overlay",

  // Mutation monitor reason codes (mutation_monitor.ts)
  overlay_injected: "A suspicious overlay was injected after the page loaded",
  form_action_changed: "A form's submission target was changed after page load",
  password_injected: "A password field was injected into an existing form",
  suspicious_iframe: "A suspicious iframe was injected after the page loaded",

  // Other event-related codes used in toasts
  clickfix_detected: "Fake verification dialog with clipboard hijack detected",
  dblclickjack_detected: "Double-click hijack attempt detected",
  mutation_alert: "Suspicious content injected after page load",
  pushstate_abuse: "Suspicious URL manipulation detected",
};

export function explainReasonCode(code: string): string {
  return EXPLANATIONS[code] ?? code;
}

export function explainReasonCodes(codes: string[]): string[] {
  return codes.map(explainReasonCode);
}
