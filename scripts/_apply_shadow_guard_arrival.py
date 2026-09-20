from pathlib import Path
from textwrap import dedent


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement anchor, found {count}")
    target.write_text(text.replace(old, new), encoding="utf-8")


Path("extension/src/content/shadow_guard_correlation.ts").write_text(
    dedent("""\
    export interface ShadowGuardCorrelationInput {
      kind?: string;
      receivedAtMs: number;
      promptShownAtMs: number;
      maxArrivalMs: number;
      messageUrl: string;
      promptUrl: string;
      messageTarget?: string;
      promptTarget?: string;
      /** Page-produced metadata; deliberately never used as clock authority. */
      producerTimestamp?: unknown;
    }

    /**
     * Correlate the MAIN-world shadow-anchor report with the local prompt using
     * only isolated-world receipt time and exact navigation identity.
     */
    export function correlatesShadowGuardPrompt(
      input: ShadowGuardCorrelationInput,
    ): boolean {
      if (input.kind !== "shadow_anchor") return false;
      if (
        !Number.isFinite(input.receivedAtMs) ||
        !Number.isFinite(input.promptShownAtMs) ||
        !Number.isFinite(input.maxArrivalMs) ||
        input.maxArrivalMs < 0
      ) {
        return false;
      }

      const arrivalAgeMs = input.receivedAtMs - input.promptShownAtMs;
      if (arrivalAgeMs < 0 || arrivalAgeMs > input.maxArrivalMs) return false;
      if (input.messageUrl !== input.promptUrl) return false;

      const promptTarget = input.promptTarget ?? "_blank";
      const messageTarget = input.messageTarget || "_blank";
      return promptTarget === messageTarget;
    }
    """),
    encoding="utf-8",
)

capture = "extension/src/content/capture_isolated.ts"
replace_once(
    capture,
    dedent("""\
    import {
      handlePushStateBridgeMessage,
      isPushStateAbuseActive,
    } from "./pushstate_guard";
    """),
    dedent("""\
    import {
      handlePushStateBridgeMessage,
      isPushStateAbuseActive,
    } from "./pushstate_guard";
    import { correlatesShadowGuardPrompt } from "./shadow_guard_correlation";
    """),
)
replace_once(
    capture,
    "const SHADOW_GUARD_CORRELATION_MS = 500;\n",
    "",
)
replace_once(
    capture,
    dedent("""\
      if (data.session !== bridgeSession) return;

      if (data.type === "ns-bridge-ready") {
    """),
    dedent("""\
      if (data.session !== bridgeSession) return;
      const receivedAtMs = Date.now();

      if (data.type === "ns-bridge-ready") {
    """),
)
replace_once(
    capture,
    dedent("""\
        const localPrompt = recentLocalBlankPrompt;
        if (
          data.kind === "shadow_anchor" &&
          localPrompt &&
          typeof data.ts === "number" &&
          Date.now() - localPrompt.shownAt <= SHADOW_GUARD_ARRIVAL_MS &&
          Math.abs(data.ts - localPrompt.shownAt) <= SHADOW_GUARD_CORRELATION_MS &&
          localPrompt.params.url === url &&
          (localPrompt.params.target ?? "_blank") === (data.target || "_blank")
        ) {
    """),
    dedent("""\
        const localPrompt = recentLocalBlankPrompt;
        if (
          localPrompt &&
          correlatesShadowGuardPrompt({
            kind: data.kind,
            receivedAtMs,
            promptShownAtMs: localPrompt.shownAt,
            maxArrivalMs: SHADOW_GUARD_ARRIVAL_MS,
            messageUrl: url,
            promptUrl: localPrompt.params.url,
            messageTarget: data.target,
            promptTarget: localPrompt.params.target,
          })
        ) {
    """),
)
replace_once(
    capture,
    dedent("""\
      const receivedAtMs = Date.now();

      if (data.type === "ns-clipboard-write") {
    """),
    dedent("""\
      if (data.type === "ns-clipboard-write") {
    """),
)

Path("tests/shadow-guard-correlation.test.ts").write_text(
    dedent("""\
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
    """),
    encoding="utf-8",
)

Path(".github/workflows/_apply-shadow-guard-arrival.yml").unlink()
Path("scripts/_apply_shadow_guard_arrival.py").unlink()
