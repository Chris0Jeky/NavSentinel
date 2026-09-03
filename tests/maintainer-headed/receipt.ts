import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type FailureClassification = "missing_input" | "invalid_input" | "repository_state" | "build_identity" | "browser_attachment" | "browser_identity" | "extension_readiness" | "fixture_execution" | "runtime_error";

export class MaintainerHeadedError extends Error {
  constructor(readonly classification: FailureClassification, readonly code: string, detail?: string) {
    super(detail ?? code);
  }
}

export type RepositorySnapshot = { head: string; status: string };

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function serializeDeterministic(value: unknown): string {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

export function redactError(error: unknown): { kind: string; sha256: string; length: number } {
  const raw = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return { kind: error instanceof MaintainerHeadedError ? error.code : error instanceof Error ? error.name : "unknown", sha256: sha256(raw), length: raw.length };
}

export function validateMaintainerInputs(env: NodeJS.ProcessEnv, repository: RepositorySnapshot): { endpoint: string; reloadHead: string; extensionId: string } {
  const endpoint = env.NAVSENTINEL_MAINTAINER_CDP_ENDPOINT?.trim();
  if (!endpoint) throw new MaintainerHeadedError("missing_input", "missing-cdp-endpoint");
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new MaintainerHeadedError("invalid_input", "invalid-cdp-endpoint"); }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(parsed.hostname) || !parsed.port || parsed.pathname !== "/" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new MaintainerHeadedError("invalid_input", "non-loopback-cdp-endpoint");
  }
  const reloadHead = env.NAVSENTINEL_MAINTAINER_RELOAD_HEAD?.trim();
  if (!reloadHead) throw new MaintainerHeadedError("missing_input", "missing-reload-head");
  if (!/^[0-9a-f]{40}$/u.test(reloadHead) || reloadHead !== repository.head) throw new MaintainerHeadedError("invalid_input", "reload-head-mismatch");
  if (env.NAVSENTINEL_MAINTAINER_DEDICATED_PROFILE !== "acknowledged") throw new MaintainerHeadedError("missing_input", "dedicated-profile-not-acknowledged");
  const extensionId = env.NAVSENTINEL_MAINTAINER_EXTENSION_ID?.trim();
  if (!extensionId) throw new MaintainerHeadedError("missing_input", "missing-extension-id");
  if (!/^[a-p]{32}$/u.test(extensionId)) throw new MaintainerHeadedError("invalid_input", "invalid-extension-id");
  if (repository.status) throw new MaintainerHeadedError("repository_state", "repository-not-clean");
  return { endpoint: parsed.href, reloadHead, extensionId };
}

export function parseChromeMetadata(value: unknown): { product: "Chrome"; version: string; debuggerUrl: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MaintainerHeadedError("browser_identity", "invalid-cdp-metadata");
  const browser = (value as Record<string, unknown>).Browser;
  if (typeof browser !== "string" || !/^Chrome\/[^/\s]+$/u.test(browser)) throw new MaintainerHeadedError("browser_identity", "non-chrome-product");
  const debuggerUrl = (value as Record<string, unknown>).webSocketDebuggerUrl;
  try {
    const parsed = new URL(typeof debuggerUrl === "string" ? debuggerUrl : "");
    if (!(parsed.protocol === "ws:" && ["127.0.0.1", "[::1]"].includes(parsed.hostname) && parsed.port && !parsed.username && !parsed.password && !parsed.search && !parsed.hash)) throw new Error("not-loopback");
    return { product: "Chrome", version: browser.slice("Chrome/".length), debuggerUrl: parsed.href };
  } catch {
    throw new MaintainerHeadedError("browser_identity", "non-loopback-cdp-metadata");
  }
}

export function readRepositorySnapshot(cwd = process.cwd()): RepositorySnapshot {
  const git = (args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  return { head: git(["rev-parse", "HEAD"]), status: git(["status", "--porcelain", "--untracked-files=normal"]) };
}

export function hashDirectory(root: string): string {
  const files: string[] = [];
  const visit = (directory: string): void => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) visit(target); else if (entry.isFile()) files.push(target); } };
  visit(root);
  return hashFiles(files, root);
}

export function hashFiles(files: readonly string[], root = process.cwd()): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) { hash.update(path.relative(root, file).replaceAll("\\", "/")); hash.update("\0"); hash.update(fs.readFileSync(file)); hash.update("\0"); }
  return hash.digest("hex");
}

export function writeEvidenceReceipt(outputDirectory: string, receipt: Record<string, unknown>): { jsonPath: string; markdownPath: string } {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const jsonPath = path.join(outputDirectory, "maintainer-headed-receipt.json");
  const markdownPath = path.join(outputDirectory, "maintainer-headed-receipt.md");
  fs.writeFileSync(jsonPath, serializeDeterministic(receipt), "utf8");
  fs.writeFileSync(markdownPath, ["# NavSentinel maintainer-headed receipt", "", `- Outcome: ${String(receipt.outcome ?? "TEST_INVALID")}`, `- Valid: ${String(receipt.valid ?? false)}`, `- Repository head: ${String(receipt.repository_head ?? "unavailable")}`, `- Failure classification: ${String(receipt.failure_classification ?? "none")}`, "", "This receipt contains typed metadata and digests only; it omits endpoints, profile paths, URLs, page content, console text, sentinels, credentials, and secrets.", ""].join("\n"), "utf8");
  return { jsonPath, markdownPath };
}
