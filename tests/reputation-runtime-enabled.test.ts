import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFilter,
  initReputation,
  insertDomain,
  serializeFilter,
} from "../extension/src/shared/reputation";
import {
  checkReputationViaMessage,
  getReputationStatus,
  isKnownBadDestination,
  loadReputationFilter,
  reputationEnabled,
} from "../extension/src/shared/reputation_runtime.enabled";

/**
 * Enabled reputation loader matrix (#wave2-slice2-B1). The disabled adapter has
 * its own suite; this one drives the real enabled loader with mocked fetch and
 * chrome.runtime.getURL: !response.ok, content-length cap, byteLength cap,
 * fetch throw, initReputation false-path, and warnOnFailure on/off.
 */

const MAX_REPUTATION_FILE_BYTES = 2 * 1024 * 1024 + 16;

const BAD_DOMAIN = "malware-test-wave2.example";
const CLEAN_DOMAIN = "clean-wave2-benign.example";

function validFilterBytes(forDomain: string): ArrayBuffer {
  const filter = createFilter(4096, 7);
  insertDomain(filter, forDomain);
  const serialized = serializeFilter(filter);
  const out = new ArrayBuffer(serialized.byteLength);
  new Uint8Array(out).set(serialized);
  return out;
}

interface StubResponseOptions {
  ok: boolean;
  status?: number;
  contentLength?: string | null;
  buffer?: ArrayBuffer;
}

function stubResponse(options: StubResponseOptions): {
  response: Response;
  arrayBuffer: ReturnType<typeof vi.fn>;
} {
  const arrayBuffer = vi.fn(async () => options.buffer ?? new ArrayBuffer(0));
  const response = {
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 404),
    headers: {
      get: (name: string): string | null =>
        name.toLowerCase() === "content-length" ? (options.contentLength ?? null) : null,
    },
    arrayBuffer,
  } as unknown as Response;
  return { response, arrayBuffer };
}

describe("enabled reputation runtime loader", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let debug: ReturnType<typeof vi.spyOn>;
  let getURL: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);
    fetchMock = vi.fn();
    vi.stubGlobal("chrome", { runtime: { getURL } });
    vi.stubGlobal("fetch", fetchMock);
    // Reset the shared reputation module state; the reset itself warns.
    expect(initReputation(new Uint8Array(0))).toBe(false);
    warn.mockClear();
    debug.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is the enabled adapter and fetches the bundled asset URL", async () => {
    expect(reputationEnabled).toBe(true);
    fetchMock.mockResolvedValueOnce(stubResponse({ ok: true, buffer: validFilterBytes(BAD_DOMAIN) }).response);
    await loadReputationFilter();
    expect(getURL).toHaveBeenCalledWith("reputation_data.bin");
    expect(fetchMock).toHaveBeenCalledWith("chrome-extension://test/reputation_data.bin");
  });

  it("loads a valid filter and reports it ready with debug", async () => {
    fetchMock.mockResolvedValueOnce(stubResponse({ ok: true, buffer: validFilterBytes(BAD_DOMAIN) }).response);
    await loadReputationFilter({ debug: true });
    expect(debug).toHaveBeenCalledWith(
      "[NavSentinel] Reputation bloom filter loaded:",
      expect.any(Number),
      "bytes",
    );
    expect(getReputationStatus(BAD_DOMAIN)).toEqual({ knownBad: true, filterReady: true });
    expect(getReputationStatus(CLEAN_DOMAIN)).toEqual({ knownBad: false, filterReady: true });
  });

  it("stays silent on success without the debug flag", async () => {
    fetchMock.mockResolvedValueOnce(stubResponse({ ok: true, buffer: validFilterBytes(BAD_DOMAIN) }).response);
    await loadReputationFilter();
    expect(debug).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(getReputationStatus(BAD_DOMAIN).filterReady).toBe(true);
  });

  it("warns and skips the body when the asset is missing (!ok)", async () => {
    const { response, arrayBuffer } = stubResponse({ ok: false, status: 404 });
    fetchMock.mockResolvedValueOnce(response);
    await loadReputationFilter({ warnOnFailure: true });
    expect(warn).toHaveBeenCalledWith(
      "[NavSentinel] Reputation filter not found (HTTP",
      404,
      ")",
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(getReputationStatus(BAD_DOMAIN)).toEqual({ knownBad: false, filterReady: false });
  });

  it("stays silent on !ok without warnOnFailure", async () => {
    fetchMock.mockResolvedValueOnce(stubResponse({ ok: false, status: 500 }).response);
    await loadReputationFilter();
    expect(warn).not.toHaveBeenCalled();
    expect(getReputationStatus(BAD_DOMAIN).filterReady).toBe(false);
  });

  it("rejects an over-cap content-length without reading the body", async () => {
    const { response, arrayBuffer } = stubResponse({
      ok: true,
      contentLength: String(MAX_REPUTATION_FILE_BYTES + 1),
      buffer: validFilterBytes(BAD_DOMAIN),
    });
    fetchMock.mockResolvedValueOnce(response);
    await loadReputationFilter({ warnOnFailure: true });
    expect(warn).toHaveBeenCalledWith(
      "[NavSentinel] Reputation file too large (Content-Length:",
      String(MAX_REPUTATION_FILE_BYTES + 1),
      ")",
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(getReputationStatus(BAD_DOMAIN).filterReady).toBe(false);
  });

  it("rejects an over-cap content-length silently without warnOnFailure", async () => {
    fetchMock.mockResolvedValueOnce(
      stubResponse({ ok: true, contentLength: String(MAX_REPUTATION_FILE_BYTES + 1) }).response,
    );
    await loadReputationFilter();
    expect(warn).not.toHaveBeenCalled();
    expect(getReputationStatus(BAD_DOMAIN).filterReady).toBe(false);
  });

  it("loads through an under-cap content-length", async () => {
    fetchMock.mockResolvedValueOnce(
      stubResponse({ ok: true, contentLength: "1024", buffer: validFilterBytes(BAD_DOMAIN) }).response,
    );
    await loadReputationFilter();
    expect(getReputationStatus(BAD_DOMAIN)).toEqual({ knownBad: true, filterReady: true });
  });

  it("rejects an over-cap body even when content-length is absent", async () => {
    fetchMock.mockResolvedValueOnce(
      stubResponse({ ok: true, buffer: new ArrayBuffer(MAX_REPUTATION_FILE_BYTES + 1) }).response,
    );
    await loadReputationFilter({ warnOnFailure: true });
    expect(warn).toHaveBeenCalledWith(
      "[NavSentinel] Reputation file too large:",
      MAX_REPUTATION_FILE_BYTES + 1,
      "bytes",
    );
    expect(getReputationStatus(BAD_DOMAIN).filterReady).toBe(false);
  });

  it("warns on a fetch throw with warnOnFailure, silently otherwise", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await loadReputationFilter({ warnOnFailure: true });
    expect(warn).toHaveBeenCalledWith(
      "[NavSentinel] Failed to load reputation filter:",
      expect.any(Error),
    );
    expect(getReputationStatus(BAD_DOMAIN).filterReady).toBe(false);

    warn.mockClear();
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await loadReputationFilter();
    expect(warn).not.toHaveBeenCalled();
  });

  it("takes the initReputation false-path on corrupt bytes (no debug, not ready)", async () => {
    // Valid HTTP envelope, garbage body: loadFilter throws inside initReputation.
    fetchMock.mockResolvedValueOnce(stubResponse({ ok: true, buffer: new ArrayBuffer(64) }).response);
    await loadReputationFilter({ debug: true, warnOnFailure: true });
    expect(debug).not.toHaveBeenCalled();
    expect(getReputationStatus(BAD_DOMAIN)).toEqual({ knownBad: false, filterReady: false });
  });

  it("matches destinations against registrable domain then hostname", async () => {
    fetchMock.mockResolvedValueOnce(stubResponse({ ok: true, buffer: validFilterBytes(BAD_DOMAIN) }).response);
    await loadReputationFilter();
    expect(isKnownBadDestination(null, "anything.example")).toBe(false);
    expect(isKnownBadDestination(BAD_DOMAIN, null)).toBe(true);
    expect(isKnownBadDestination(BAD_DOMAIN, BAD_DOMAIN)).toBe(true);
    expect(isKnownBadDestination("host.example", BAD_DOMAIN)).toBe(true);
    expect(isKnownBadDestination(CLEAN_DOMAIN, CLEAN_DOMAIN)).toBe(false);
    expect(getReputationStatus("")).toEqual({ knownBad: false, filterReady: true });
  });

  it("reports not-ready destinations before any load", () => {
    expect(isKnownBadDestination(BAD_DOMAIN, BAD_DOMAIN)).toBe(false);
    expect(getReputationStatus(BAD_DOMAIN)).toEqual({ knownBad: false, filterReady: false });
  });

  it("re-exported message check degrades when messaging throws", async () => {
    await expect(checkReputationViaMessage(BAD_DOMAIN)).resolves.toEqual({
      knownBad: false,
      filterReady: false,
    });
  });
});
