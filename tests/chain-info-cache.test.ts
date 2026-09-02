import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHAIN_INFO_RETRY_DELAY_MS,
  CHAIN_INFO_TTL_MS,
  getFreshChainInfo,
  handleChainInfoPageShow,
  primeChainInfoCache,
  _resetChainInfoCache,
} from "../extension/src/content/chain_info_cache";

type SendMessageCallback = (resp: unknown) => void;

interface SentRequest {
  message: unknown;
  respond: SendMessageCallback;
}

let sent: SentRequest[] = [];
let lastError: { message: string } | undefined;
let throwOnSend = false;

function installChromeStub(): void {
  sent = [];
  lastError = undefined;
  throwOnSend = false;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      get lastError() {
        return lastError;
      },
      sendMessage(message: unknown, cb: SendMessageCallback) {
        if (throwOnSend) throw new Error("Extension context invalidated.");
        sent.push({ message, respond: cb });
      },
    },
  };
}

/** Deliver a reply to the Nth outstanding request, optionally as a lastError. */
function reply(index: number, resp: unknown, err?: string): void {
  lastError = err ? { message: err } : undefined;
  sent[index]!.respond(resp);
  lastError = undefined;
}

const GOOD = {
  depth: 4,
  viaKnownRedirector: true,
  knownRedirectorHops: 2,
  expiresAt: 2_000_000_000_000,
};

describe("chain_info_cache (#389)", () => {
  beforeEach(() => {
    installChromeStub();
    _resetChainInfoCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetChainInfoCache();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  describe("priming", () => {
    it("sends ns-get-chain-info as soon as it is primed", () => {
      primeChainInfoCache();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.message).toEqual({ type: "ns-get-chain-info" });
    });

    it("does not send anything before priming", () => {
      expect(sent).toHaveLength(0);
      expect(getFreshChainInfo()).toBeNull();
    });

    it("is idempotent — a second prime does not start a second request chain", () => {
      primeChainInfoCache();
      primeChainInfoCache();
      primeChainInfoCache();
      expect(sent).toHaveLength(1);
    });
  });

  describe("caching the reply", () => {
    it("caches a well-formed chain info reply", () => {
      primeChainInfoCache();
      reply(0, GOOD);
      expect(getFreshChainInfo()).toEqual(GOOD);
    });

    it("caches a copy, so a later mutation of the reply object cannot alter the cache", () => {
      const resp = { ...GOOD };
      primeChainInfoCache();
      reply(0, resp);
      resp.depth = 99;
      expect(getFreshChainInfo()?.depth).toBe(4);
    });

    it("caches depth 0 (a real 'no redirects' answer)", () => {
      const expiresAt = Date.now() + CHAIN_INFO_TTL_MS;
      primeChainInfoCache();
      reply(0, { depth: 0, viaKnownRedirector: false, knownRedirectorHops: 0, expiresAt });
      expect(getFreshChainInfo()).toEqual({
        depth: 0,
        viaKnownRedirector: false,
        knownRedirectorHops: 0,
        expiresAt,
      });
    });
  });

  describe("TTL", () => {
    it("returns the cached info inside the TTL", () => {
      primeChainInfoCache();
      reply(0, GOOD);
      const at = Date.now();
      expect(getFreshChainInfo(at + CHAIN_INFO_TTL_MS)).toEqual(GOOD);
    });

    it("returns null once the TTL has elapsed", () => {
      primeChainInfoCache();
      reply(0, GOOD);
      const at = Date.now();
      expect(getFreshChainInfo(at + CHAIN_INFO_TTL_MS + 1)).toBeNull();
    });

    it("returns null once the worker-provided expiry has elapsed", () => {
      const at = Date.now();
      primeChainInfoCache();
      reply(0, { ...GOOD, expiresAt: at + 1_000 });
      expect(getFreshChainInfo(at + 1_000)).toBeNull();
    });

    it("invalidates and reprimes after a BFCache restore", () => {
      primeChainInfoCache();
      reply(0, GOOD);
      expect(getFreshChainInfo()).toEqual(GOOD);

      handleChainInfoPageShow({ persisted: false });
      expect(sent).toHaveLength(1);
      expect(getFreshChainInfo()).toEqual(GOOD);

      handleChainInfoPageShow({ persisted: true });
      expect(sent).toHaveLength(2);
      expect(sent[1]!.message).toEqual({ type: "ns-get-chain-info" });
      expect(getFreshChainInfo()).toBeNull();
    });
  });

  describe("reply validation", () => {
    const malformed: Array<[string, unknown]> = [
      ["null", null],
      ["undefined", undefined],
      ["a non-object", "nope"],
      ["a partial object (depth only)", { depth: 3 }],
      ["a non-numeric depth", { depth: "3", viaKnownRedirector: false, knownRedirectorHops: 0 }],
      ["a negative depth", { depth: -1, viaKnownRedirector: false, knownRedirectorHops: 0 }],
      ["a NaN depth", { depth: NaN, viaKnownRedirector: false, knownRedirectorHops: 0 }],
      [
        "a non-boolean viaKnownRedirector",
        { depth: 3, viaKnownRedirector: "yes", knownRedirectorHops: 0 },
      ],
      [
        "a non-numeric knownRedirectorHops",
        { depth: 3, viaKnownRedirector: true, knownRedirectorHops: null },
      ],
      [
        "a negative knownRedirectorHops",
        { depth: 3, viaKnownRedirector: true, knownRedirectorHops: -2 },
      ],
    ];

    for (const [label, resp] of malformed) {
      it(`rejects ${label} and leaves the cache empty`, () => {
        primeChainInfoCache();
        reply(0, resp);
        expect(getFreshChainInfo()).toBeNull();
      });
    }
  });

  describe("bounded retry", () => {
    it("retries once when the first reply reports chrome.runtime.lastError", () => {
      primeChainInfoCache();
      reply(0, undefined, "The message port closed before a response was received.");
      expect(sent).toHaveLength(1);
      vi.advanceTimersByTime(CHAIN_INFO_RETRY_DELAY_MS);
      expect(sent).toHaveLength(2);
      reply(1, GOOD);
      expect(getFreshChainInfo()).toEqual(GOOD);
    });

    it("retries once when the first reply is malformed", () => {
      primeChainInfoCache();
      reply(0, { depth: "bad" });
      vi.advanceTimersByTime(CHAIN_INFO_RETRY_DELAY_MS);
      expect(sent).toHaveLength(2);
      reply(1, GOOD);
      expect(getFreshChainInfo()).toEqual(GOOD);
    });

    it("retries once when sendMessage throws synchronously", () => {
      throwOnSend = true;
      primeChainInfoCache();
      expect(sent).toHaveLength(0);
      throwOnSend = false;
      vi.advanceTimersByTime(CHAIN_INFO_RETRY_DELAY_MS);
      expect(sent).toHaveLength(1);
      reply(0, GOOD);
      expect(getFreshChainInfo()).toEqual(GOOD);
    });

    it("stops after the single retry — no unbounded message loop", () => {
      primeChainInfoCache();
      reply(0, undefined, "port closed");
      vi.advanceTimersByTime(CHAIN_INFO_RETRY_DELAY_MS);
      expect(sent).toHaveLength(2);
      reply(1, undefined, "port closed");
      vi.advanceTimersByTime(CHAIN_INFO_RETRY_DELAY_MS * 20);
      expect(sent).toHaveLength(2);
      expect(getFreshChainInfo()).toBeNull();
    });

    it("does not retry after a successful reply", () => {
      primeChainInfoCache();
      reply(0, GOOD);
      vi.advanceTimersByTime(CHAIN_INFO_RETRY_DELAY_MS * 20);
      expect(sent).toHaveLength(1);
    });
  });

  describe("first-eval staleness (documented residual)", () => {
    it("returns null while the reply is still in flight — the decision path never blocks", () => {
      primeChainInfoCache();
      // Reply outstanding: a click evaluating NRS right now gets no chain info.
      expect(getFreshChainInfo()).toBeNull();
      reply(0, GOOD);
      // The next evaluation within the TTL sees it.
      expect(getFreshChainInfo()).toEqual(GOOD);
    });
  });
});

/**
 * Wiring assertion: the whole point of #389 is *when* the request is issued.
 * `initSettings()` awaits three storage round-trips, so anything sent from
 * inside its body is issued that much later. This asserts the request no
 * longer originates there — it fails against the pre-fix source, where the
 * `ns-get-chain-info` send lived at the tail of `initSettings()`.
 */
describe("capture_isolated chain-info priming order (#389)", () => {
  const source = readFileSync(
    resolve("extension/src/content/capture_isolated.ts"),
    "utf8",
  );

  /** Return the body of the named function via brace matching. */
  function functionBody(src: string, signature: string): string {
    const start = src.indexOf(signature);
    if (start < 0) throw new Error(`signature not found: ${signature}`);
    const open = src.indexOf("{", start);
    if (open < 0) throw new Error(`no body for: ${signature}`);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) return src.slice(open, i + 1);
      }
    }
    throw new Error(`unbalanced body for: ${signature}`);
  }

  const initBody = functionBody(source, "async function initSettings()");

  it("primes the chain-info cache somewhere in the module", () => {
    expect(source).toContain("primeChainInfoCache()");
  });

  it("does not prime from inside initSettings(), which awaits storage first", () => {
    expect(initBody).not.toContain("primeChainInfoCache");
  });

  it("no longer sends ns-get-chain-info from inside initSettings()", () => {
    expect(initBody).not.toContain('"ns-get-chain-info"');
  });

  it("leaves the ns-get-chain-info send to chain_info_cache.ts alone", () => {
    // The message-type literal (as opposed to prose in a comment) must not
    // appear anywhere in capture_isolated.ts any more.
    expect(source).not.toContain('"ns-get-chain-info"');
  });

  it("reads the cache synchronously on the decision path", () => {
    expect(source).toContain("getFreshChainInfo()");
    expect(source).not.toContain("await getFreshChainInfo");
  });
});
