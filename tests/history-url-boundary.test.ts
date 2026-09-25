// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const originalPushState = Object.getOwnPropertyDescriptor(
  History.prototype,
  "pushState",
);
const originalReplaceState = Object.getOwnPropertyDescriptor(
  History.prototype,
  "replaceState",
);

afterEach(() => {
  vi.resetModules();
  if (originalPushState) {
    Object.defineProperty(History.prototype, "pushState", originalPushState);
  }
  if (originalReplaceState) {
    Object.defineProperty(History.prototype, "replaceState", originalReplaceState);
  }
});

describe("history URL coercion boundary", () => {
  it("passes primitive Symbols through to the monitored native binding", async () => {
    let capturedUrl: unknown;
    Object.defineProperty(History.prototype, "pushState", {
      configurable: true,
      writable: true,
      value(_data: unknown, _unused: string, url?: unknown): void {
        capturedUrl = url;
      },
    });

    const boundary = (await import(
      "../extension/src/content/history_url_boundary"
    )) as unknown as { installStableHistoryBoundary?: () => void };
    boundary.installStableHistoryBoundary?.();

    const url = Symbol("history-url");
    history.pushState({}, "", url as unknown as string);

    expect(capturedUrl).toBe(url);
  });

  it("installs inside main_guard after its monitoring patch", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "extension", "manifest.json"), "utf8"),
    ) as {
      content_scripts: Array<{ world?: string; js: string[] }>;
    };
    const mainWorld = manifest.content_scripts.find(
      (entry) => entry.world === "MAIN",
    );
    expect(mainWorld?.js).toEqual(["src/content/main_guard.ts"]);

    const source = fs.readFileSync(
      path.join(
        repoRoot,
        "extension",
        "src",
        "content",
        "main_guard.ts",
      ),
      "utf8",
    );
    expect(source).toContain(
      'import { installStableHistoryBoundary } from "./history_url_boundary";',
    );

    const patchIndex = source.lastIndexOf("patchHistory();");
    const boundaryIndex = source.lastIndexOf(
      "installStableHistoryBoundary();",
    );
    expect(patchIndex).toBeGreaterThan(-1);
    expect(boundaryIndex).toBeGreaterThan(patchIndex);
  });
});
