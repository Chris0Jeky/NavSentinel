import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Check the artifact the specs will load: they honour EXTENSION_PATH the same way.
export function defaultManifestPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.EXTENSION_PATH
    ? path.join(path.resolve(env.EXTENSION_PATH), "manifest.json")
    : fileURLToPath(new URL("../../extension/dist/manifest.json", import.meta.url));
}

export function assertE2eBuild(manifestPath = defaultManifestPath()): void {
  if (process.env.NAVSENTINEL_ALLOW_MISSING_BUILD === "1") return;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      manifest_version?: number;
      content_scripts?: { js?: string[] }[];
      background?: { service_worker?: string };
    };
    const scripts = [
      ...(manifest.content_scripts?.flatMap((script) => script.js ?? []) ?? []),
      manifest.background?.service_worker,
    ];
    if (manifest.manifest_version === 3 && scripts.some((script) => {
      if (typeof script !== "string") return false;
      const filename = path.join(path.dirname(manifestPath), script);
      return existsSync(filename) && statSync(filename).isFile();
    })) return;
  } catch {
    // Missing and malformed artifacts need the same actionable build error.
  }
  throw new Error(
    // #1192: no opt-out hint here. A run with every spec skipped exits 0 and proves nothing.
    `Extension build missing: ${manifestPath}. Run npm run build before E2E tests.`,
  );
}

export default function globalSetup(): void {
  assertE2eBuild();
}
