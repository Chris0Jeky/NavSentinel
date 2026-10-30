/**
 * Per-load attribution for the AI-47 row 8 clipboard-pressure arms (#954 item 2).
 *
 * A discarded RETRY load can deliver its clickfix_detected row late, after the
 * next load's baseline. Counting by kind alone then reports +2 for the selected
 * attack arm. Each load is instead served under its own path label
 * (`/acceptance/pressure-load/<label>/<gym file>`), which the product keeps in
 * the stored `url` (origin + path; see minimizeEventUrl), so every row names
 * the load that produced it. A row that cannot be attributed to a load this
 * session issued is TEST_INVALID: nothing is counted from an unknown source.
 */

const LOAD_ROUTE = /^\/acceptance\/pressure-load\/(load-\d+)(\/[^/].*)$/;

/** Path for one load. The label is short and readable so the product's opaque-token path redaction keeps it. */
export function pressureLoadPath(label: string, gymPath: string): string {
  return `/acceptance/pressure-load/${label}${gymPath}`;
}

/** The Gym file a pressure-load path serves, or null when the path is not one. */
export function pressureLoadGymPath(pathname: string): string | null {
  return LOAD_ROUTE.exec(pathname)?.[2] ?? null;
}

type Row = Record<string, unknown>;

/**
 * Count `kind` rows produced by the loads in `labels`. Every `kind` row not in
 * `preexisting` (by id) must be a row from `origin`/`host` carrying a label in
 * `issued` and the expected Gym path; otherwise this throws TEST_INVALID.
 */
export function attributedCount(
  log: Row[],
  kind: string,
  labels: ReadonlySet<string>,
  scope: { origin: string; host: string; gymPath: string; issued: ReadonlySet<string>; preexisting: ReadonlySet<string> },
): number {
  let count = 0;
  for (const row of log) {
    if (row.kind !== kind || scope.preexisting.has(String(row.id))) continue;
    let url: URL | null;
    try { url = typeof row.url === "string" ? new URL(row.url) : null; } catch { url = null; }
    const match = url ? LOAD_ROUTE.exec(url.pathname) : null;
    const label = match?.[1];
    if (!url || url.origin !== scope.origin || !label || match?.[2] !== scope.gymPath || !scope.issued.has(label)
      || row.site !== scope.host || (row.pageSite !== undefined && row.pageSite !== scope.host)) {
      throw new Error(`TEST_INVALID: unattributable ${kind} row ${JSON.stringify({ id: row.id, site: row.site, pageSite: row.pageSite, url: row.url })}`);
    }
    if (labels.has(label)) count++;
  }
  return count;
}
