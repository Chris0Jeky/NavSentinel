import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MaintainerHeadedError, parseChromeMetadata, redactError, serializeDeterministic, sha256, validateMaintainerInputs, writeEvidenceReceipt } from "./receipt";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

describe("maintainer-headed receipt contract", () => {
  const repository = { head: "a".repeat(40), status: "" };

  it("accepts only loopback CDP, the exact current head, a dedicated-profile acknowledgement, and a clean repository", () => {
    const valid = { NAVSENTINEL_MAINTAINER_CDP_ENDPOINT: "http://127.0.0.1:9222", NAVSENTINEL_MAINTAINER_RELOAD_HEAD: repository.head, NAVSENTINEL_MAINTAINER_DEDICATED_PROFILE: "acknowledged", NAVSENTINEL_MAINTAINER_EXTENSION_ID: "a".repeat(32) };
    expect(validateMaintainerInputs(valid, repository)).toMatchObject({ reloadHead: repository.head });
    expect(() => validateMaintainerInputs({}, repository)).toThrow(MaintainerHeadedError);
    expect(() => validateMaintainerInputs({ ...valid, NAVSENTINEL_MAINTAINER_CDP_ENDPOINT: "http://example.test:9222" }, repository)).toThrow("non-loopback-cdp-endpoint");
    expect(() => validateMaintainerInputs({ ...valid, NAVSENTINEL_MAINTAINER_CDP_ENDPOINT: "http://127.0.0.1:9222/not-root" }, repository)).toThrow("non-loopback-cdp-endpoint");
    expect(() => validateMaintainerInputs({ ...valid, NAVSENTINEL_MAINTAINER_RELOAD_HEAD: "b".repeat(40) }, repository)).toThrow("reload-head-mismatch");
    expect(() => validateMaintainerInputs({ ...valid, NAVSENTINEL_MAINTAINER_EXTENSION_ID: "not-an-extension-id" }, repository)).toThrow("invalid-extension-id");
    expect(() => validateMaintainerInputs(valid, { ...repository, status: "?? unexpected.txt" })).toThrow("repository-not-clean");
  });

  it("accepts only redaction-safe Chrome CDP product metadata", () => {
    expect(parseChromeMetadata({ Browser: "Chrome/140.0.7339.1", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/token" })).toEqual({ product: "Chrome", version: "140.0.7339.1", debuggerUrl: "ws://127.0.0.1:9222/devtools/browser/token" });
    expect(() => parseChromeMetadata({ Browser: "Chromium/140.0.0.0" })).toThrow("non-chrome-product");
    expect(() => parseChromeMetadata({ Browser: "Chrome/140.0.0.0", webSocketDebuggerUrl: "ws://remote.invalid:9222/token" })).toThrow("non-loopback-cdp-metadata");
  });

  it("serializes deterministically and redacts raw failures", () => {
    expect(serializeDeterministic({ z: 1, a: { y: 2, b: 3 } })).toBe(serializeDeterministic({ a: { b: 3, y: 2 }, z: 1 }));
    const secret = "secret-value-must-not-persist";
    const redacted = redactError(new Error(secret));
    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(redacted.sha256).toBe(sha256(`Error:${secret}`));
  });

  it("writes TEST_INVALID JSON and Markdown receipts without raw failure text", () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-receipt-"));
    directories.push(output);
    const secret = "endpoint-and-secret-must-not-persist";
    const receipt = writeEvidenceReceipt(output, { outcome: "TEST_INVALID", valid: false, repository_head: "a".repeat(40), failure_classification: "missing_input", failure: redactError(new Error(secret)) });
    expect(fs.readFileSync(receipt.jsonPath, "utf8")).not.toContain(secret);
    expect(fs.readFileSync(receipt.markdownPath, "utf8")).not.toContain(secret);
    expect(fs.readFileSync(receipt.jsonPath, "utf8")).toContain("TEST_INVALID");
    expect(fs.readFileSync(receipt.markdownPath, "utf8")).toContain("Failure classification: missing_input");
  });
});
