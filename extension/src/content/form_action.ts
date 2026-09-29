/**
 * Shared form-action resolution contract (#650).
 *
 * Both the isolated-world intent probe (`formSubmitIntentUrl` in
 * capture_isolated.ts) and the MAIN-world enforcement point
 * (`resolveFormAction` in main_guard.ts) must agree on the exact string they
 * compare, so the resolution lives here as a pure, unit-testable helper. The
 * MAIN-world wiring that calls it is covered by the Gym/E2E form fixtures.
 *
 * Contract:
 * - An explicitly present `formaction` attribute overrides the form `action`,
 *   even when empty; only a missing attribute inherits the form action.
 * - A missing/empty effective action means the current document.
 * - Relative actions resolve against the effective document base URL
 *   (`document.baseURI`, which honors `<base href>`), matching what the
 *   browser will actually submit to. Resolving against `location.href`
 *   instead misbinds the allowance whenever a base element is present.
 * - Only `http:`/`https:` results are returned. Non-HTTP schemes
 *   (`javascript:`, `data:`, ...) never navigate cross-document, so they must
 *   not mint navigation intent or a redirect allowance. Unparseable input
 *   fails closed to null.
 */
export function resolveFormActionUrl(args: {
  /** Raw `formaction` attribute of the submitter, or null when absent. */
  submitterAction: string | null;
  /** Raw `action` attribute of the form, or null when absent. */
  formAction: string | null;
  /** Effective document base URL (`document.baseURI` at the call site). */
  baseURI: string;
  /** Current document URL (`location.href` at the call site). */
  documentURL: string;
}): string | null {
  const raw = args.submitterAction ?? args.formAction;
  if (!raw) {
    return isHttpUrl(args.documentURL) ? args.documentURL : null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw, args.baseURI);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? parsed.toString()
    : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
