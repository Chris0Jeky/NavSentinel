import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createIssue593DiagnosticsWriter } from "./e2e/issue593-diagnostics";

const FIXTURE_PREFIX = "navsentinel-issue593-diagnostics-";

function withTempRoot(check: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  try {
    check(root);
  } finally {
    // Cleanup is limited to this test's own verified temp directory.
    expect(root).toContain(FIXTURE_PREFIX);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function serialize(payload: Record<string, unknown>): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

describe("issue #593 diagnostics retention", () => {
  it("survives a later lane that clears only the disposable output root", () => {
    withTempRoot((root) => {
      const disposableRoot = path.join(root, "test-results", "artifacts");
      const retentionRoot = path.join(root, "artifacts", "issue593");
      const first = createIssue593DiagnosticsWriter(retentionRoot);

      const baselinePath = path.join(
        disposableRoot,
        "issue593-hidden-media-layer",
        "baseline-top-assign-100-diagnostics.json",
      );
      const protectedPath = path.join(
        disposableRoot,
        "issue593-hidden-media-layer",
        "protected-top-assign-100-diagnostics.json",
      );
      const retryPath = path.join(
        disposableRoot,
        "issue593-hidden-media-layer-retry-1",
        "protected-top-assign-100-diagnostics.json",
      );
      expect(new Set([baselinePath, protectedPath, retryPath]).size).toBe(3);

      const baseline = serialize({
        mode: "baseline",
        arm: "top-assign-100",
        fixtureUrl: "http://localhost:5173/synthetic-fixture?arm=top-assign-100",
        sinkReceiptsAfter: 1,
      });
      const protectedFailure = serialize({
        mode: "protected",
        arm: "top-assign-100",
        fixtureUrl: "http://localhost:5173/synthetic-fixture?arm=top-assign-100",
        topReturnedToFixture: false,
        sinkReceiptsAfter: 1,
      });
      const retryProtected = serialize({
        mode: "protected",
        arm: "top-assign-100",
        attempt: "retry-1",
        fixtureUrl: "http://localhost:5173/synthetic-fixture?arm=top-assign-100",
        topReturnedToFixture: false,
        sinkReceiptsAfter: 1,
      });

      const retainedBaseline = first(disposableRoot, baselinePath, baseline);
      const retainedProtected = first(disposableRoot, protectedPath, protectedFailure);
      const retainedRetry = first(disposableRoot, retryPath, retryProtected);

      // The test/project/retry hierarchy is preserved, not collapsed.
      expect(new Set([retainedBaseline, retainedProtected, retainedRetry]).size).toBe(3);

      // The attachment source (disposable file) carries exactly the retained bytes.
      const pairs: Array<[string, string]> = [
        [baselinePath, retainedBaseline],
        [protectedPath, retainedProtected],
        [retryPath, retainedRetry],
      ];
      for (const [disposable, retained] of pairs) {
        expect(fs.readFileSync(disposable, "utf8")).toBe(fs.readFileSync(retained, "utf8"));
      }
      const earlierBytes = pairs.map(([, retained]) => fs.readFileSync(retained, "utf8"));

      // Model a later lane: only this fixture's disposable root is cleared.
      fs.rmSync(disposableRoot, { recursive: true, force: true });
      expect(fs.existsSync(baselinePath)).toBe(false);
      fs.mkdirSync(disposableRoot, { recursive: true });

      const second = createIssue593DiagnosticsWriter(retentionRoot);
      const reseatedBaseline = second(disposableRoot, baselinePath, baseline);
      const reseatedProtected = second(disposableRoot, protectedPath, protectedFailure);
      const reseatedRetry = second(disposableRoot, retryPath, retryProtected);

      // A fresh writer mints a fresh run directory, never reusing the first.
      expect(reseatedBaseline).not.toBe(retainedBaseline);
      expect(reseatedProtected).not.toBe(retainedProtected);
      expect(reseatedRetry).not.toBe(retainedRetry);

      // Every earlier retained byte sequence still exists unchanged.
      expect(pairs.map(([, retained]) => fs.readFileSync(retained, "utf8"))).toEqual(earlierBytes);
      // The second invocation wrote the same bytes to its own destinations.
      expect(fs.readFileSync(reseatedProtected, "utf8")).toBe(protectedFailure);
      expect(fs.readFileSync(protectedPath, "utf8")).toBe(protectedFailure);
    });
  });

  it("rejects paths outside the disposable output root", () => {
    withTempRoot((root) => {
      const disposableRoot = path.join(root, "test-results", "artifacts");
      fs.mkdirSync(disposableRoot, { recursive: true });
      const writer = createIssue593DiagnosticsWriter(path.join(root, "artifacts", "issue593"));
      const outside = path.join(root, "outside-diagnostics.json");
      expect(() => writer(disposableRoot, outside, "{}\n")).toThrow(
        "escapes the disposable output root",
      );
      expect(fs.existsSync(outside)).toBe(false);
    });
  });
});
