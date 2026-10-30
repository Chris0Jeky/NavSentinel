import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function assertE2eBuild(
  manifestPath = fileURLToPath(new URL("../../extension/dist/manifest.json", import.meta.url)),
): void {
  if (process.env.NAVSENTINEL_ALLOW_MISSING_BUILD === "1") return;
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Extension build missing: ${manifestPath}. Run npm run build before E2E tests, ` +
      "or set NAVSENTINEL_ALLOW_MISSING_BUILD=1 to intentionally run without a build.",
    );
  }
}

export default function globalSetup(): void {
  assertE2eBuild();
}
