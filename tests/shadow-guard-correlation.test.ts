import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { correlatesShadowGuardPrompt } from "../extension/src/content/shadow_guard_correlation";

const NOW = 2_000_000_000_000;
const base = {
  kind: "shadow_anchor",
  receivedAtMs: NOW + 100,
  promptShownAtMs: NOW,
  maxArrivalMs: 1500,
  messageUrl: "https://example.test/target",
  promptUrl: "https://example.test/target",
  messageTarget: "_blank",
  promptTarget: "_blank",
} as const;

describe("shadow guard receiver-time correlation", () => {
  it("matches a fresh exact report regardless of a future producer timestamp", () => {
    expect(correlatesShadowGuardPrompt({
      ...base,
      producerTimestamp: NOW + 86_400_000,
    })).toBe(true);
  });

  it("matches a fresh exact report regardless of a stale producer timestamp", () => {
    expect(correlatesShadowGuardPrompt({
      ...base,
      producerTimestamp: NOW - 86_400_000,
    })).toBe(true);
  });

  it("rejects an expired receipt even when producer metadata looks fresh", () => {
    expect(correlatesShadowGuardPrompt({
      ...base,
      receivedAtMs: NOW + 1501,
      producerTimestamp: NOW + 100,
    })).toBe(false);
  });

  it("rejects a receiver clock that predates the local prompt", () => {
    expect(correlatesShadowGuardPrompt({
      ...base,
      receivedAtMs: NOW - 1,
    })).toBe(false);
  });

  it("requires exact URL and target identity", () => {
    expect(correlatesShadowGuardPrompt({
      ...base,
      messageUrl: "https://example.test/other",
    })).toBe(false);
    expect(correlatesShadowGuardPrompt({
      ...base,
      messageTarget: "named-window",
    })).toBe(false);
  });

  it("wires capture correlation through authenticated local arrival time", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../extension/src/content/capture_isolated.ts"),
      "utf8",
    );

    expect(source).toContain(
      'import { correlatesShadowGuardPrompt } from "./shadow_guard_correlation";',
    );
    expect(source).toMatch(
      /correlatesShadowGuardPrompt\(\{[\s\S]*?receivedAtMs,[\s\S]*?promptShownAtMs:/u,
    );
    expect(source).not.toContain("Math.abs(data.ts - localPrompt.shownAt)");
    expect(source).not.toContain("SHADOW_GUARD_CORRELATION_MS");
    expect(source).not.toContain("producerTimestamp: data.ts");
  });
});
