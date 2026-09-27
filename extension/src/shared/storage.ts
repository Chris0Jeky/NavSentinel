/**
 * Stable storage entry point.
 *
 * The persistence implementation remains in `storage_impl.ts`; this façade keeps
 * every existing import path stable while owning the extension-page message
 * response boundary. The worker may serialize an authorization/validation error
 * as `{ ok: false, error }`; the legacy implementation otherwise remains byte-for-
 * byte unchanged and continues to own queues, conflicts, imports, and persistence.
 */
export * from "./storage_impl";

import {
  updateSuiteSettings as updateSuiteSettingsImpl,
  type SuiteSettings,
  type SuiteSettingsPatch,
} from "./storage_impl";

/** A successful worker response that preserves current settings for conflict recovery. */
export type SuiteSettingsUpdateSuccessResponse = SuiteSettings & { conflict?: true };

/** A rejected worker write, serialized across the runtime message boundary. */
export type SuiteSettingsUpdateErrorResponse = { ok: false; error: string };

/** The complete service-worker response contract for a settings update. */
export type SuiteSettingsUpdateResponse =
  | SuiteSettingsUpdateSuccessResponse
  | SuiteSettingsUpdateErrorResponse;

function isSuiteSettingsUpdateError(
  response: SuiteSettings | SuiteSettingsUpdateErrorResponse,
): response is SuiteSettingsUpdateErrorResponse {
  return "ok" in response && response.ok === false;
}

export async function updateSuiteSettings(
  partial: SuiteSettingsPatch,
  expected?: SuiteSettings,
): Promise<SuiteSettings> {
  const response = await updateSuiteSettingsImpl(partial, expected) as
    | SuiteSettings
    | SuiteSettingsUpdateErrorResponse;
  if (isSuiteSettingsUpdateError(response)) {
    throw new Error(response.error || "suite-settings update failed");
  }
  return response;
}

// Source-level portability contract: the vision-lab evidence tests intentionally
// parse this union from storage.ts so its independent allowlist cannot drift.
export type EventKind =
  | "nav_blank_prompt"
  | "nav_click_block"
  | "nav_silent_allow"
  | "nav_rollback"
  | "nav_allowlist_add"
  | "nav_allowlist_remove"
  | "cred_submit_prompt"
  | "cred_submit_allow_once"
  | "cred_trust_domain"
  | "cred_untrust_domain"
  | "cred_paste_warn"
  | "cred_form_evaluated"
  | "suite_config_update"
  | "clickfix_detected"
  | "dblclickjack_detected"
  | "nav_reputation_late_warn"
  | "mutation_alert"
  | "pushstate_abuse"
  | "bridge_buffer_overflow";
