import { describe, expect, it } from "vitest";
import {
  assertContentAddressedLoader,
  assertUiGuardRevision,
  contentAddressedLoaderPath,
  contentLoaderDigest,
  finalizeUiGuardLoader,
  UI_GUARD_REVISION_PLACEHOLDER,
} from "../scripts/content-loader-contract.mjs";

describe("final content-script loader identity", () => {
  it("changes the manifest path whenever post-build bytes change", () => {
    const first = contentAddressedLoaderPath(
      "assets/main_guard.ts-loader-vitehash.js",
      "guard-v1",
    );
    const second = contentAddressedLoaderPath(
      "assets/main_guard.ts-loader-vitehash.js",
      "guard-v2",
    );

    expect(first).toBe(
      `assets/main_guard.ts-loader-${contentLoaderDigest("guard-v1")}.js`,
    );
    expect(second).not.toBe(first);
  });

  it("rejects a final loader whose manifest URL describes earlier bytes", () => {
    expect(() => assertContentAddressedLoader(
      "assets/main_guard.ts-loader-vitehash.js",
      "post-processed guard",
    )).toThrow("Final content-script loader bytes do not match their manifest URL");
  });

  it("derives a runtime revision that changes with the final guard template", () => {
    const first = finalizeUiGuardLoader(
      `before setAttribute('data-navsentinel-ui-guard','${UI_GUARD_REVISION_PLACEHOLDER}') after-v1`,
    );
    const second = finalizeUiGuardLoader(
      `before setAttribute('data-navsentinel-ui-guard','${UI_GUARD_REVISION_PLACEHOLDER}') after-v2`,
    );

    expect(first.revision).toHaveLength(12);
    expect(assertUiGuardRevision(first.content)).toBe(first.revision);
    expect(second.revision).not.toBe(first.revision);
  });

  it("rejects a stale runtime revision after the guard changes", () => {
    const finalized = finalizeUiGuardLoader(
      `before setAttribute('data-navsentinel-ui-guard','${UI_GUARD_REVISION_PLACEHOLDER}') after`,
    );
    const changed = `${finalized.content} changed`;

    expect(() => assertUiGuardRevision(changed)).toThrow(
      "UI-guard loader revision is stale",
    );
  });
});
