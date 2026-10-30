import { existsSync } from "node:fs";
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
  if (!existsSync(manifestPath)) {
    throw new Error(
      // #1192: no opt-out hint here. A run with every spec skipped exits 0 and proves nothing.
      `Extension build missing: ${manifestPath}. Run npm run build before E2E tests.`,
    );
  }
}

export default function globalSetup(): void {
  assertE2eBuild();
}
