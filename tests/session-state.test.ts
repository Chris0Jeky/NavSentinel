import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStateManager } from "../extension/src/shared/session_state";

// ---------------------------------------------------------------------------
// Minimal chrome.storage.session mock
// ---------------------------------------------------------------------------

function createSessionStorageMock() {
  let store: Record<string, unknown> = {};
  return {
    get store() { return store; },
    mock: {
      async get(keys?: string | string[]) {
        if (keys === undefined) return { ...store };
        if (typeof keys === "string") {
          return { [keys]: store[keys] };
        }
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          result[key] = store[key];
        }
        return result;
      },
      async set(items: Record<string, unknown>) {
        Object.assign(store, items);
      },
      async remove(keys: string | string[]) {
        const keyList = typeof keys === "string" ? [keys] : keys;
        for (const key of keyList) {
          delete store[key];
        }
      },
    },
    clear() {
      store = {};
    },
  };
}

describe("SessionStateManager", () => {
  let sessionStorage: ReturnType<typeof createSessionStorageMock>;

  beforeEach(() => {
    sessionStorage = createSessionStorageMock();
    vi.stubGlobal("chrome", {
      storage: {
        session: sessionStorage.mock,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // Hydration
  // -----------------------------------------------------------------------

  it("hydrates maps from empty session storage without errors", async () => {
    const mgr = new SessionStateManager();
    await mgr.hydrate();
    expect(mgr.hydrated).toBe(true);
    expect(mgr.allowUntilByTab.size).toBe(0);
    expect(mgr.readyTabs.size).toBe(0);
  });

  it("hydrates maps from populated session storage", async () => {
    // Pre-populate session storage with serialised state
    await sessionStorage.mock.set({
      "ns_sw:allowUntil": { "7": 123456 },
      "ns_sw:gestureUntil": { "8": 789012 },
      "ns_sw:readyTabs": [7, 8, 9],
      "ns_sw:lastUrl": { "7": "https://example.test/" },
      "ns_sw:childWindow": {
        "10": { openerTabId: 7, createdAt: 100000, openerNavObserved: true },
      },
    });

    const mgr = new SessionStateManager();
    await mgr.hydrate();

    expect(mgr.allowUntilByTab.get(7)).toBe(123456);
    expect(mgr.gestureUntilByTab.get(8)).toBe(789012);
    expect(mgr.readyTabs.has(7)).toBe(true);
    expect(mgr.readyTabs.has(8)).toBe(true);
    expect(mgr.readyTabs.has(9)).toBe(true);
    expect(mgr.readyTabs.size).toBe(3);
    expect(mgr.lastUrlByTab.get(7)).toBe("https://example.test/");
    expect(mgr.childWindowByTab.get(10)).toEqual({
      openerTabId: 7,
      createdAt: 100000,
      openerNavObserved: true,
    });
  });

  it("gracefully handles corrupted session storage data", async () => {
    await sessionStorage.mock.set({
      "ns_sw:allowUntil": "not-an-object",
      "ns_sw:readyTabs": "not-an-array",
    });

    const mgr = new SessionStateManager();
    await mgr.hydrate();

    expect(mgr.hydrated).toBe(true);
    expect(mgr.allowUntilByTab.size).toBe(0);
    expect(mgr.readyTabs.size).toBe(0);
  });

  it("skips malformed captureTimestamps entries (non-array / non-number) on restore (#339)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sessionStorage.mock.set({
      "ns_sw:captureTimestamps": {
        "5": "not-an-array", // would break sw.ts list.filter(...) if restored
        "6": [100, 200], // valid
        "7": [1, "x", 3], // mixed-type array -> invalid
      },
    });

    const mgr = new SessionStateManager();
    await mgr.hydrate();

    // Only the valid number[] survives; the non-array and mixed array are dropped.
    expect(mgr.captureTimestampsByTab.get(6)).toEqual([100, 200]);
    expect(mgr.captureTimestampsByTab.has(5)).toBe(false);
    expect(mgr.captureTimestampsByTab.has(7)).toBe(false);
    expect(warnSpy).toHaveBeenCalled(); // corrupt restore is surfaced, not silent
    warnSpy.mockRestore();
  });

  it("drops malformed structured-map entries (corrupt numeric / shape fields) on restore (#339)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sessionStorage.mock.set({
      // oauthFlow: corrupt startedAt (NaN-poisons pruneStaleOAuthFlows) + bad phase
      // (evades redirect-mismatch detection); one valid entry survives.
      "ns_sw:oauthFlow": {
        "1": { initiatorUrl: "https://app.test/", consentUrl: "https://accounts.google.com/authorize", expectedCallbackDomain: "app.test", startedAt: null, phase: "redirect" },
        "2": { initiatorUrl: "https://app.test/", consentUrl: "https://accounts.google.com/authorize", expectedCallbackDomain: "app.test", startedAt: 1000, phase: "not-a-phase" },
        "3": { initiatorUrl: "https://app.test/", consentUrl: "https://accounts.google.com/authorize", expectedCallbackDomain: "app.test", startedAt: 1000, phase: "consent" },
        // NaN startedAt survives structured-clone (chrome.storage.session is NOT JSON) and
        // would poison pruneStaleOAuthFlows' `now - startedAt` comparison — only Number.isFinite
        // rejects it (a plain typeof===number check would pass). (#365 review F-1)
        "4": { initiatorUrl: "https://app.test/", consentUrl: "https://accounts.google.com/authorize", expectedCallbackDomain: "app.test", startedAt: NaN, phase: "redirect" },
      },
      // childWindow: corrupt createdAt -> NaN prune + DoubleClickjacking false-negative;
      // openerTabId 0 passes isFiniteNumber but makes the child-closed sendMessage fail
      // silently (Chrome tab IDs are always >= 1). (#365 review SEC-02)
      "ns_sw:childWindow": {
        "10": { openerTabId: 7, createdAt: "bad", openerNavObserved: true },
        "11": { openerTabId: 7, createdAt: 100000, openerNavObserved: true },
        "12": { openerTabId: 0, createdAt: 100000, openerNavObserved: true },
      },
      // pendingForward: corrupt ts -> stale offer never reaped by the ts-expiry guard.
      "ns_sw:pendingForward": {
        "20": { url: "https://evil.test/", ts: null, returnUrl: "https://safe.test/" },
        "21": { url: "https://e.test/", ts: 5000 },
      },
      // lastCommitted: corrupt ts -> false rollback for a same-site nav after restart.
      "ns_sw:lastCommitted": {
        "30": { url: "https://example.com/p1", prevUrl: "https://example.com/", transitionType: "link", qualifiers: [], ts: "corrupted", allowedAtCommit: true },
        "31": { url: "https://example.com/p2", transitionType: "link", qualifiers: [], ts: 9000, allowedAtCommit: false },
      },
      // rollbackReturn: corrupt expiresAt (string -> coercion keeps a stale return alive).
      "ns_sw:rollbackReturn": {
        "40": { url: "https://safe.test/", expiresAt: "99999999999999" },
        "41": { url: "https://safe.test/", expiresAt: 123456 },
      },
      // allowTarget: corrupt expiresAt / silentEvent / matchQueryPrefix; one fully-valid.
      "ns_sw:allowTarget": {
        "50": { url: "https://t.test/", expiresAt: null },
        "51": { url: "https://t.test/", expiresAt: 123456 },
        "52": { url: "https://t.test/", expiresAt: 123456, silentEvent: "not-an-object" },
        "53": { url: "https://t.test/", expiresAt: 123456, matchQueryPrefix: "yes" },
        "54": { url: "https://t.test/", expiresAt: 123456, matchQueryPrefix: true, silentEvent: { type: "ns-event-log-append" } },
      },
      // pendingRollback: corrupt qualifiers (not a string array).
      "ns_sw:pendingRollback": {
        "60": { url: "https://r.test/", qualifiers: "nope" },
        "61": { url: "https://r.test/", qualifiers: ["foo"] },
      },
      // typedOrigin: corrupt ts -> would invalidate the typed-origin TTL window. The NaN ts
      // and Infinity deadline cases prove the Number.isFinite gate is load-bearing (both
      // survive structured-clone and pass a plain typeof===number check). (#365 review F-1)
      "ns_sw:typedOrigin": {
        "70": { ts: "bad", deadline: 1000 },
        "71": { ts: 5, deadline: 1000 },
        "72": { ts: NaN, deadline: 1000 },
        "73": { ts: 5, deadline: Infinity },
      },
      // simple number map: a non-number per-entry value would NaN a navigation-allow check.
      "ns_sw:allowUntil": {
        "80": "not-a-number",
        "81": 12345,
      },
      // suppressUntil: a far-future numeric STRING coerces under `now <= suppressUntil` to a
      // permanently-active suppress window, silently dropping every suspicious nav after a
      // restart; isFiniteNumber rejects it. (#365 review F-2)
      "ns_sw:suppressUntil": {
        "82": "9999999999999999",
        "83": 500,
      },
      // userNavContextUntil: a NaN/string value would fake a recent-user-nav context and
      // suppress rollback triggering; previously had NO test of any kind. (#365 review F-2)
      "ns_sw:userNavContextUntil": {
        "84": NaN,
        "85": 1000,
      },
      // simple string map: a numeric value would break domain parsing on prevUrl.
      "ns_sw:lastUrl": {
        "90": 42,
        "91": "https://ok.test/",
      },
      // redirectChains: corrupt startedAt / hop.ts / hop.transitionType -> NaN sort +
      // never-pruned (#339); empty-hops is rejected (a live chain always has >= 1 hop, #390).
      "ns_sw:redirectChains": {
        "100": { hops: [{ url: "https://a.test/", ts: 10, transitionType: "link" }], startedAt: "bad" },
        "101": { hops: [{ url: "https://a.test/", ts: null, transitionType: "link" }], startedAt: 1000 },
        "102": { hops: [{ url: "https://a.test/", ts: 10, transitionType: "link" }], startedAt: 1000 },
        "103": { hops: [], startedAt: 1000 },
        "104": { hops: [{ url: "https://a.test/", ts: 10, transitionType: 42 }], startedAt: 1000 },
        // Infinity startedAt: never time-pruned (`now - Infinity > X` is false) + NaN sort key.
        "105": { hops: [{ url: "https://a.test/", ts: 10, transitionType: "link" }], startedAt: Infinity },
      },
    });

    const mgr = new SessionStateManager();
    await mgr.hydrate();

    // Corrupt entries are dropped on restore; valid ones survive. (Pre-fix: all restored.)
    expect(mgr.oauthFlowByTab.has(1)).toBe(false); // startedAt null
    expect(mgr.oauthFlowByTab.has(2)).toBe(false); // bad phase
    expect(mgr.oauthFlowByTab.get(3)?.phase).toBe("consent");
    expect(mgr.oauthFlowByTab.has(4)).toBe(false); // startedAt NaN
    expect(mgr.childWindowByTab.has(10)).toBe(false); // createdAt "bad"
    expect(mgr.childWindowByTab.get(11)?.createdAt).toBe(100000);
    expect(mgr.childWindowByTab.has(12)).toBe(false); // openerTabId 0 (Chrome IDs are >= 1)
    expect(mgr.pendingForwardByTab.has(20)).toBe(false); // ts null
    expect(mgr.pendingForwardByTab.get(21)?.ts).toBe(5000);
    expect(mgr.lastCommittedByTab.has(30)).toBe(false); // ts "corrupted"
    expect(mgr.lastCommittedByTab.get(31)?.ts).toBe(9000);
    expect(mgr.rollbackReturnByTab.has(40)).toBe(false); // expiresAt string
    expect(mgr.rollbackReturnByTab.get(41)?.expiresAt).toBe(123456);
    expect(mgr.allowTargetByTab.has(50)).toBe(false); // expiresAt null
    expect(mgr.allowTargetByTab.get(51)?.expiresAt).toBe(123456);
    expect(mgr.allowTargetByTab.has(52)).toBe(false); // silentEvent not an object
    expect(mgr.allowTargetByTab.has(53)).toBe(false); // matchQueryPrefix not true
    expect(mgr.allowTargetByTab.get(54)?.expiresAt).toBe(123456); // valid incl. silentEvent
    expect(mgr.pendingRollbackByTab.has(60)).toBe(false); // qualifiers not array
    expect(mgr.pendingRollbackByTab.get(61)?.qualifiers).toEqual(["foo"]);
    expect(mgr.typedOriginByTab.has(70)).toBe(false); // ts "bad"
    expect(mgr.typedOriginByTab.get(71)?.ts).toBe(5);
    expect(mgr.typedOriginByTab.has(72)).toBe(false); // ts NaN (passes typeof, fails isFinite)
    expect(mgr.typedOriginByTab.has(73)).toBe(false); // deadline Infinity
    expect(mgr.allowUntilByTab.has(80)).toBe(false); // non-number
    expect(mgr.allowUntilByTab.get(81)).toBe(12345);
    expect(mgr.suppressUntilByTab.has(82)).toBe(false); // numeric string coerces under `<=`
    expect(mgr.suppressUntilByTab.get(83)).toBe(500);
    expect(mgr.userNavContextUntilByTab.has(84)).toBe(false); // NaN
    expect(mgr.userNavContextUntilByTab.get(85)).toBe(1000);
    expect(mgr.lastUrlByTab.has(90)).toBe(false); // numeric, not a string
    expect(mgr.lastUrlByTab.get(91)).toBe("https://ok.test/");
    expect(mgr.redirectChainData.has(100)).toBe(false); // startedAt "bad"
    expect(mgr.redirectChainData.has(101)).toBe(false); // hop.ts null
    expect(mgr.redirectChainData.get(102)?.startedAt).toBe(1000);
    expect(mgr.redirectChainData.has(103)).toBe(false); // empty hops rejected (#390)
    expect(mgr.redirectChainData.has(104)).toBe(false); // hop.transitionType not a string
    expect(mgr.redirectChainData.has(105)).toBe(false); // startedAt Infinity
    expect(warnSpy).toHaveBeenCalled(); // corrupt restore is surfaced, not silent
    warnSpy.mockRestore();
  });

  it("drops corrupt optional-string fields, non-durable OAuth phases, and array-typed values on restore (#365 review)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sessionStorage.mock.set({
      // oauthFlow phase 'callback' is never durably persisted (set transiently then advanced
      // to 'complete' before persistMap); a restored 'callback' would slip past the
      // redirect/consent-only mismatch branch, so it must be dropped. 'complete' is durable.
      "ns_sw:oauthFlow": {
        "1": { initiatorUrl: "https://app.test/", consentUrl: "https://accounts.google.com/authorize", expectedCallbackDomain: "app.test", startedAt: 1000, phase: "callback" },
        "2": { initiatorUrl: "https://app.test/", consentUrl: "https://accounts.google.com/authorize", expectedCallbackDomain: "app.test", startedAt: 1000, phase: "complete" },
      },
      // pendingForward returnUrl: a corrupt truthy non-string strands the forward offer
      // (matches neither the `=== currentUrl` nor the `!returnUrl` branch).
      "ns_sw:pendingForward": {
        "10": { url: "https://e.test/", ts: 5000, returnUrl: 42 },
        "11": { url: "https://e.test/", ts: 5000, returnUrl: "https://ok.test/" },
        "12": { url: "https://e.test/", ts: 5000 }, // returnUrl absent is valid
      },
      // pendingRollback prevUrl: corrupt non-string reaches the rollback message + URL parse.
      "ns_sw:pendingRollback": {
        "20": { url: "https://r.test/", qualifiers: [], prevUrl: 99 },
        "21": { url: "https://r.test/", qualifiers: [], prevUrl: "https://prev.test/" },
      },
      // lastCommitted prevUrl: same string-or-absent gate.
      "ns_sw:lastCommitted": {
        "30": { url: "https://example.com/p", transitionType: "link", qualifiers: [], ts: 1, allowedAtCommit: true, prevUrl: {} },
        "31": { url: "https://example.com/p", transitionType: "link", qualifiers: [], ts: 1, allowedAtCommit: true, prevUrl: "https://example.com/" },
      },
      // an array where a record is expected must be rejected (isRecord excludes arrays);
      // likewise an array-typed silentEvent must not pass the `isRecord` check.
      "ns_sw:allowTarget": {
        "40": [],
        "41": { url: "https://t.test/", expiresAt: 123456, silentEvent: ["not", "a", "record"] },
        "42": { url: "https://t.test/", expiresAt: 123456 },
      },
    });

    const mgr = new SessionStateManager();
    await mgr.hydrate();

    expect(mgr.oauthFlowByTab.has(1)).toBe(false); // phase 'callback' is not durable
    expect(mgr.oauthFlowByTab.get(2)?.phase).toBe("complete");
    expect(mgr.pendingForwardByTab.has(10)).toBe(false); // returnUrl non-string
    expect(mgr.pendingForwardByTab.get(11)?.returnUrl).toBe("https://ok.test/");
    expect(mgr.pendingForwardByTab.get(12)?.url).toBe("https://e.test/"); // absent is valid
    expect(mgr.pendingRollbackByTab.has(20)).toBe(false); // prevUrl non-string
    expect(mgr.pendingRollbackByTab.get(21)?.prevUrl).toBe("https://prev.test/");
    expect(mgr.lastCommittedByTab.has(30)).toBe(false); // prevUrl non-string (object)
    expect(mgr.lastCommittedByTab.get(31)?.prevUrl).toBe("https://example.com/");
    expect(mgr.allowTargetByTab.has(40)).toBe(false); // array, not a record
    expect(mgr.allowTargetByTab.has(41)).toBe(false); // silentEvent is an array
    expect(mgr.allowTargetByTab.get(42)?.expiresAt).toBe(123456);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("enters degraded mode and suppresses persistence when the hydrate read fails (#228.2)", async () => {
    // Intact stored state that a transient read failure must not wipe.
    await sessionStorage.mock.set({ "ns_sw:allowUntil": { "7": 123456 } });
    const failingGet = vi.fn().mockRejectedValue(new Error("transient read failure"));
    sessionStorage.mock.get = failingGet;

    const mgr = new SessionStateManager();
    await mgr.hydrate();

    expect(mgr.hydrated).toBe(true); // reads allowed so handlers do not block forever
    expect(mgr.canPersist).toBe(false); // persistence suppressed
    expect(failingGet).toHaveBeenCalledTimes(2); // initial + one retry

    const setSpy = vi.spyOn(sessionStorage.mock, "set");
    mgr.allowUntilByTab.set(99, 1);
    mgr.persistMap(mgr.allowUntilByTab, "allowUntil");
    mgr.persistAll();
    mgr.persistReadyTabs();
    expect(setSpy).not.toHaveBeenCalled();
    // The pre-existing stored entry is still intact (not overwritten by empty maps).
    expect(sessionStorage.store["ns_sw:allowUntil"]).toEqual({ "7": 123456 });
  });

  it("re-enables persistence after a successful hydrate (#228.2)", async () => {
    const mgr = new SessionStateManager();
    await mgr.hydrate();
    expect(mgr.canPersist).toBe(true);

    const setSpy = vi.spyOn(sessionStorage.mock, "set");
    mgr.allowUntilByTab.set(5, 999);
    mgr.persistMap(mgr.allowUntilByTab, "allowUntil");
    expect(setSpy).toHaveBeenCalled();
  });

  it("retries the hydrate read once before degrading (#228.2)", async () => {
    await sessionStorage.mock.set({ "ns_sw:allowUntil": { "7": 1 } });
    const origGet = sessionStorage.mock.get.bind(sessionStorage.mock);
    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockImplementation((keys?: string | string[]) => origGet(keys));
    sessionStorage.mock.get = flaky as typeof sessionStorage.mock.get;

    const mgr = new SessionStateManager();
    await mgr.hydrate();

    expect(flaky).toHaveBeenCalledTimes(2);
    expect(mgr.canPersist).toBe(true); // retry succeeded -> not degraded
    expect(mgr.allowUntilByTab.get(7)).toBe(1);
  });

  it("degraded mode prevents the tab-close path from wiping intact storage (#228.2)", async () => {
    // Two intact keys neither in-memory map knows about (both empty after a failed
    // hydrate) -- a persistAll must not wipe either.
    await sessionStorage.mock.set({
      "ns_sw:allowUntil": { "7": 123456 },
      "ns_sw:gestureUntil": { "8": 999 },
    });
    sessionStorage.mock.get = vi.fn().mockRejectedValue(new Error("read fail"));

    const mgr = new SessionStateManager();
    await mgr.hydrate();
    expect(mgr.canPersist).toBe(false);

    const setSpy = vi.spyOn(sessionStorage.mock, "set");
    // Realistic tab-close path: bulk per-map delete (deleteTab calls persistAll),
    // plus a direct persistAll, must NOT overwrite the intact stored entries.
    mgr.deleteTab(7);
    mgr.persistAll();
    expect(setSpy).not.toHaveBeenCalled();
    expect(sessionStorage.store["ns_sw:allowUntil"]).toEqual({ "7": 123456 });
    expect(sessionStorage.store["ns_sw:gestureUntil"]).toEqual({ "8": 999 });
  });

  it("gracefully handles session storage API failure", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: async () => { throw new Error("storage unavailable"); },
          set: async () => { throw new Error("storage unavailable"); },
        },
      },
    });

    const mgr = new SessionStateManager();
    await mgr.hydrate();

    expect(mgr.hydrated).toBe(true);
    expect(mgr.allowUntilByTab.size).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Write-through persistence
  // -----------------------------------------------------------------------

  it("persists a single map to session storage", async () => {
    const mgr = new SessionStateManager();
    await mgr.hydrate();

    mgr.allowUntilByTab.set(7, 123456);
    mgr.persistMap(mgr.allowUntilByTab, "allowUntil");

    // Wait for the fire-and-forget write
    await new Promise((r) => setTimeout(r, 0));

    const data = await sessionStorage.mock.get("ns_sw:allowUntil");
    expect(data["ns_sw:allowUntil"]).toEqual({ "7": 123456 });
  });

  it("persists readyTabs set to session storage", async () => {
    const mgr = new SessionStateManager();
    await mgr.hydrate();

    mgr.readyTabs.add(7);
    mgr.readyTabs.add(8);
    mgr.persistReadyTabs();

    await new Promise((r) => setTimeout(r, 0));

    const data = await sessionStorage.mock.get("ns_sw:readyTabs");
    const arr = data["ns_sw:readyTabs"] as number[];
    expect(arr).toContain(7);
    expect(arr).toContain(8);
    expect(arr.length).toBe(2);
  });

  it("persists all state in a single batch write", async () => {
    const mgr = new SessionStateManager();
    await mgr.hydrate();

    mgr.allowUntilByTab.set(7, 123456);
    mgr.gestureUntilByTab.set(8, 789012);
    mgr.readyTabs.add(9);
    mgr.lastUrlByTab.set(7, "https://example.test/");
    mgr.persistAll();

    await new Promise((r) => setTimeout(r, 0));

    const data = await sessionStorage.mock.get([
      "ns_sw:allowUntil",
      "ns_sw:gestureUntil",
      "ns_sw:readyTabs",
      "ns_sw:lastUrl",
    ]);
    expect(data["ns_sw:allowUntil"]).toEqual({ "7": 123456 });
    expect(data["ns_sw:gestureUntil"]).toEqual({ "8": 789012 });
    expect(data["ns_sw:readyTabs"]).toContain(9);
    expect(data["ns_sw:lastUrl"]).toEqual({ "7": "https://example.test/" });
  });

  // -----------------------------------------------------------------------
  // State survives simulated SW restart
  // -----------------------------------------------------------------------

  it("state survives a simulated SW restart via hydration", async () => {
    // Phase 1: write state with manager A
    const mgrA = new SessionStateManager();
    await mgrA.hydrate();

    mgrA.allowUntilByTab.set(7, 999999);
    mgrA.gestureUntilByTab.set(8, 888888);
    mgrA.allowStartedByTab.set(7, "https://example.test/nav");
    mgrA.allowTargetByTab.set(7, { url: "https://target.test/", expiresAt: 999999 });
    mgrA.suppressUntilByTab.set(7, 777777);
    mgrA.typedOriginByTab.set(7, { ts: 100000, deadline: 200000 });
    mgrA.readyTabs.add(7);
    mgrA.pendingRollbackByTab.set(7, {
      url: "https://evil.test/",
      prevUrl: "https://safe.test/",
      qualifiers: ["client_redirect"],
    });
    mgrA.pendingForwardByTab.set(7, { url: "https://evil.test/", ts: 100000 });
    mgrA.rollbackReturnByTab.set(7, { url: "https://safe.test/", expiresAt: 999999 });
    mgrA.lastUrlByTab.set(7, "https://current.test/");
    mgrA.lastCommittedByTab.set(7, {
      url: "https://evil.test/",
      prevUrl: "https://safe.test/",
      transitionType: "link",
      qualifiers: ["client_redirect"],
      ts: 100000,
      allowedAtCommit: false,
    });
    mgrA.childWindowByTab.set(10, {
      openerTabId: 7,
      createdAt: 100000,
      openerNavObserved: true,
    });
    mgrA.oauthFlowByTab.set(7, {
      initiatorUrl: "https://app.test/",
      consentUrl: "https://oauth.test/authorize",
      expectedCallbackDomain: "app.test",
      startedAt: 100000,
      phase: "redirect",
    });
    mgrA.redirectChainData.set(7, {
      hops: [
        { url: "https://a.test/", ts: 100000, transitionType: "link" },
        { url: "https://b.test/", ts: 100100, transitionType: "link" },
      ],
      startedAt: 100000,
    });

    // Persist all state
    mgrA.persistAll();
    await new Promise((r) => setTimeout(r, 0));

    // Phase 2: "restart" -- create a new manager that knows nothing
    // and hydrate from the same session storage
    const mgrB = new SessionStateManager();
    expect(mgrB.allowUntilByTab.size).toBe(0); // empty before hydration
    await mgrB.hydrate();

    // Verify all state was restored
    expect(mgrB.allowUntilByTab.get(7)).toBe(999999);
    expect(mgrB.gestureUntilByTab.get(8)).toBe(888888);
    expect(mgrB.allowStartedByTab.get(7)).toBe("https://example.test/nav");
    expect(mgrB.allowTargetByTab.get(7)).toEqual({
      url: "https://target.test/",
      expiresAt: 999999,
    });
    expect(mgrB.suppressUntilByTab.get(7)).toBe(777777);
    expect(mgrB.typedOriginByTab.get(7)).toEqual({ ts: 100000, deadline: 200000 });
    expect(mgrB.readyTabs.has(7)).toBe(true);
    expect(mgrB.pendingRollbackByTab.get(7)).toEqual({
      url: "https://evil.test/",
      prevUrl: "https://safe.test/",
      qualifiers: ["client_redirect"],
    });
    expect(mgrB.pendingForwardByTab.get(7)).toEqual({
      url: "https://evil.test/",
      ts: 100000,
    });
    expect(mgrB.rollbackReturnByTab.get(7)).toEqual({
      url: "https://safe.test/",
      expiresAt: 999999,
    });
    expect(mgrB.lastUrlByTab.get(7)).toBe("https://current.test/");
    expect(mgrB.lastCommittedByTab.get(7)).toEqual({
      url: "https://evil.test/",
      prevUrl: "https://safe.test/",
      transitionType: "link",
      qualifiers: ["client_redirect"],
      ts: 100000,
      allowedAtCommit: false,
    });
    expect(mgrB.childWindowByTab.get(10)).toEqual({
      openerTabId: 7,
      createdAt: 100000,
      openerNavObserved: true,
    });
    expect(mgrB.oauthFlowByTab.get(7)).toEqual({
      initiatorUrl: "https://app.test/",
      consentUrl: "https://oauth.test/authorize",
      expectedCallbackDomain: "app.test",
      startedAt: 100000,
      phase: "redirect",
    });
    expect(mgrB.redirectChainData.get(7)).toEqual({
      hops: [
        { url: "https://a.test/", ts: 100000, transitionType: "link" },
        { url: "https://b.test/", ts: 100100, transitionType: "link" },
      ],
      startedAt: 100000,
    });
  });

  // -----------------------------------------------------------------------
  // Tab state isolation
  // -----------------------------------------------------------------------

  it("deleteTab clears only the specified tab across all maps", async () => {
    const mgr = new SessionStateManager();
    await mgr.hydrate();

    // Set state for tab 7 and tab 8
    mgr.allowUntilByTab.set(7, 100);
    mgr.allowUntilByTab.set(8, 200);
    mgr.gestureUntilByTab.set(7, 300);
    mgr.gestureUntilByTab.set(8, 400);
    mgr.readyTabs.add(7);
    mgr.readyTabs.add(8);
    mgr.lastUrlByTab.set(7, "https://a.test/");
    mgr.lastUrlByTab.set(8, "https://b.test/");
    mgr.childWindowByTab.set(7, { openerTabId: 1, createdAt: 0, openerNavObserved: false });
    mgr.oauthFlowByTab.set(7, {
      initiatorUrl: "",
      consentUrl: "",
      expectedCallbackDomain: "",
      startedAt: 0,
      phase: "redirect",
    });
    mgr.redirectChainData.set(7, { hops: [], startedAt: 0 });
    mgr.redirectChainData.set(8, { hops: [], startedAt: 0 });
    mgr.captureTimestampsByTab.set(7, [1, 2, 3]);
    mgr.captureTimestampsByTab.set(8, [4, 5, 6]);

    // Delete tab 7
    mgr.deleteTab(7);
    await new Promise((r) => setTimeout(r, 0));

    // Tab 7 state should be gone
    expect(mgr.allowUntilByTab.has(7)).toBe(false);
    expect(mgr.gestureUntilByTab.has(7)).toBe(false);
    expect(mgr.readyTabs.has(7)).toBe(false);
    expect(mgr.lastUrlByTab.has(7)).toBe(false);
    expect(mgr.childWindowByTab.has(7)).toBe(false);
    expect(mgr.oauthFlowByTab.has(7)).toBe(false);
    expect(mgr.redirectChainData.has(7)).toBe(false);
    expect(mgr.captureTimestampsByTab.has(7)).toBe(false);

    // Tab 8 state should be untouched
    expect(mgr.allowUntilByTab.get(8)).toBe(200);
    expect(mgr.gestureUntilByTab.get(8)).toBe(400);
    expect(mgr.readyTabs.has(8)).toBe(true);
    expect(mgr.lastUrlByTab.get(8)).toBe("https://b.test/");
    expect(mgr.redirectChainData.has(8)).toBe(true);
    expect(mgr.captureTimestampsByTab.get(8)).toEqual([4, 5, 6]);

    // Verify session storage also persisted the cleanup
    const stored = await sessionStorage.mock.get("ns_sw:allowUntil");
    expect(stored["ns_sw:allowUntil"]).toEqual({ "8": 200 });
  });

  // -----------------------------------------------------------------------
  // Serialisation edge cases
  // -----------------------------------------------------------------------

  it("handles non-numeric keys in stored objects gracefully", async () => {
    await sessionStorage.mock.set({
      "ns_sw:allowUntil": { "abc": 123, "7": 456, "NaN": 789 },
    });

    const mgr = new SessionStateManager();
    await mgr.hydrate();

    // Only valid numeric keys should be restored
    expect(mgr.allowUntilByTab.get(7)).toBe(456);
    expect(mgr.allowUntilByTab.size).toBe(1);
  });

  it("handles null/undefined values in stored data", async () => {
    await sessionStorage.mock.set({
      "ns_sw:allowUntil": null,
      "ns_sw:readyTabs": null,
    });

    const mgr = new SessionStateManager();
    await mgr.hydrate();

    expect(mgr.hydrated).toBe(true);
    expect(mgr.allowUntilByTab.size).toBe(0);
    expect(mgr.readyTabs.size).toBe(0);
  });

  it("handles arrays stored where objects expected", async () => {
    await sessionStorage.mock.set({
      "ns_sw:allowUntil": [1, 2, 3],
    });

    const mgr = new SessionStateManager();
    await mgr.hydrate();

    // Arrays have numeric keys (indices), so entries may be restored
    // The important thing is no crash
    expect(mgr.hydrated).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Complex object persistence
  // -----------------------------------------------------------------------

  it("round-trips lastCommittedByTab correctly", async () => {
    const mgr = new SessionStateManager();
    await mgr.hydrate();

    const entry = {
      url: "https://evil.test/phish",
      prevUrl: "https://safe.test/home",
      transitionType: "link",
      qualifiers: ["client_redirect", "server_redirect"],
      ts: 1700000000000,
      allowedAtCommit: false,
    };

    mgr.lastCommittedByTab.set(42, entry);
    mgr.persistMap(mgr.lastCommittedByTab, "lastCommitted");
    await new Promise((r) => setTimeout(r, 0));

    // Create new manager and hydrate
    const mgr2 = new SessionStateManager();
    await mgr2.hydrate();

    expect(mgr2.lastCommittedByTab.get(42)).toEqual(entry);
  });

  it("round-trips pendingRollbackByTab with optional prevUrl", async () => {
    const mgr = new SessionStateManager();
    await mgr.hydrate();

    // Entry without prevUrl
    mgr.pendingRollbackByTab.set(10, {
      url: "https://evil.test/",
      qualifiers: ["server_redirect"],
    });
    mgr.persistMap(mgr.pendingRollbackByTab, "pendingRollback");
    await new Promise((r) => setTimeout(r, 0));

    const mgr2 = new SessionStateManager();
    await mgr2.hydrate();

    const restored = mgr2.pendingRollbackByTab.get(10);
    expect(restored).toBeDefined();
    expect(restored!.url).toBe("https://evil.test/");
    expect(restored!.prevUrl).toBeUndefined();
    expect(restored!.qualifiers).toEqual(["server_redirect"]);
  });

  it("round-trips captureTimestampsByTab so the capture rate limit survives a SW restart (D-SWRATE)", async () => {
    const mgr = new SessionStateManager();
    await mgr.hydrate();

    // Three captures already used in the window for tab 7.
    mgr.captureTimestampsByTab.set(7, [100, 200, 300]);
    mgr.persistMap(mgr.captureTimestampsByTab, "captureTimestamps");
    await new Promise((r) => setTimeout(r, 0));

    // Simulated restart: a fresh manager must see the prior counts, so the
    // rate limit cannot be reset by forcing the worker to recycle.
    const mgr2 = new SessionStateManager();
    expect(mgr2.captureTimestampsByTab.size).toBe(0); // empty before hydration
    await mgr2.hydrate();
    expect(mgr2.captureTimestampsByTab.get(7)).toEqual([100, 200, 300]);
  });
});

describe("SW integration: state persistence through session storage", () => {
  // This group tests the actual sw.ts module's interaction with session storage

  type RuntimeMessage = Record<string, unknown>;
  type RuntimeSender = { tab?: { id?: number; url?: string }; frameId?: number };
  type SendResponse = (response?: unknown) => void;

  function createEvent<T extends (...args: never[]) => void>() {
    const listeners: T[] = [];
    return {
      addListener(listener: T) { listeners.push(listener); },
      emit(...args: Parameters<T>) {
        for (const listener of listeners) { listener(...args); }
      },
    };
  }

  function createChromeMock() {
    const runtimeOnMessage = createEvent<
      (message: RuntimeMessage, sender: RuntimeSender, sendResponse: SendResponse) => void
    >();
    const runtimeOnInstalled = createEvent<() => void>();
    const runtimeOnStartup = createEvent<() => void>();
    const storageOnChanged = createEvent<
      (changes: Record<string, { oldValue: unknown; newValue: unknown }>, areaName: string) => void
    >();
    const beforeNavigate = createEvent<
      (details: { tabId: number; frameId: number; url: string }) => void
    >();
    const errorOccurred = createEvent<
      (details: { tabId: number; frameId: number; url?: string }) => void
    >();
    const committed = createEvent<
      (details: {
        tabId: number;
        frameId: number;
        url: string;
        transitionType: string;
        transitionQualifiers?: string[];
      }) => void
    >();
    const tabCreated = createEvent<(tab: { id?: number; openerTabId?: number }) => void>();
    const tabRemoved = createEvent<(tabId: number) => void>();
    const tabUpdated = createEvent<
      (tabId: number, changeInfo: { status?: string; url?: string }, tab: { url?: string }) => void
    >();
    const sentMessages: Array<{
      tabId: number;
      message: unknown;
      options?: { frameId?: number };
    }> = [];

    const sessionStore: Record<string, unknown> = {};

    return {
      chrome: {
        runtime: {
          onMessage: runtimeOnMessage,
          onInstalled: runtimeOnInstalled,
          onStartup: runtimeOnStartup,
          getURL: (path: string) => `chrome-extension://test/${path}`,
          lastError: null as null | { message: string },
        },
        storage: {
          local: {
            async get(keys?: string | string[]) {
              if (keys === undefined) return {};
              if (typeof keys === "string") return {};
              return Object.fromEntries(keys.map((key) => [key, undefined]));
            },
            async set() {},
            async remove() {},
          },
          session: {
            async get(keys?: string | string[]) {
              if (keys === undefined) return { ...sessionStore };
              if (typeof keys === "string") {
                return { [keys]: sessionStore[keys] };
              }
              const result: Record<string, unknown> = {};
              for (const key of keys) {
                result[key] = sessionStore[key];
              }
              return result;
            },
            async set(items: Record<string, unknown>) {
              Object.assign(sessionStore, items);
            },
            async remove(keys: string | string[]) {
              const keyList = typeof keys === "string" ? [keys] : keys;
              for (const key of keyList) {
                delete sessionStore[key];
              }
            },
          },
          onChanged: storageOnChanged,
        },
        declarativeNetRequest: {
          updateEnabledRulesets: vi.fn().mockResolvedValue(undefined),
        },
        webNavigation: {
          onBeforeNavigate: beforeNavigate,
          onCommitted: committed,
          onErrorOccurred: errorOccurred,
        },
        tabs: {
          onCreated: tabCreated,
          onRemoved: tabRemoved,
          onUpdated: tabUpdated,
          sendMessage: vi.fn(
            (
              tabId: number,
              message: unknown,
              optionsOrCallback?: { frameId?: number } | (() => void),
              callback?: () => void,
            ) => {
              const options =
                typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
              const done = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
              sentMessages.push({
                tabId,
                message,
                ...(options ? { options } : {}),
              });
              done?.();
            },
          ),
        },
      },
      sessionStore,
      emitBeforeNavigate(details: { tabId: number; frameId: number; url: string }) {
        beforeNavigate.emit(details);
      },
      emitCommitted(details: {
        tabId: number;
        frameId: number;
        url: string;
        transitionType: string;
        transitionQualifiers?: string[];
      }) {
        committed.emit(details);
      },
      emitErrorOccurred(details: { tabId: number; frameId: number; url?: string }) {
        errorOccurred.emit(details);
      },
      emitTabCreated(tab: { id?: number; openerTabId?: number }) {
        tabCreated.emit(tab);
      },
      emitTabRemoved(tabId: number) {
        tabRemoved.emit(tabId);
      },
      dispatchRuntimeMessage(message: RuntimeMessage, sender: RuntimeSender = {}) {
        let response: unknown;
        runtimeOnMessage.emit(message, sender, (value) => {
          response = value;
        });
        return response;
      },
      sentMessages,
    };
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T12:00:00.000Z"));
    // Stub fetch to prevent loadReputationFilter from hanging
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network in tests")));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Flush microtasks and pending promise chains. */
  async function flushAsync(): Promise<void> {
    // Flush microtask queue multiple times to ensure all chained
    // promise callbacks (from fire-and-forget storage writes) resolve.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  }

  it("persists gesture state to session storage on ns-nav-gesture", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");
    await flushAsync();

    mock.dispatchRuntimeMessage(
      { type: "ns-nav-gesture", ttlMs: 1200 },
      { tab: { id: 7 } },
    );
    await flushAsync();

    const stored = mock.sessionStore["ns_sw:gestureUntil"] as Record<string, number>;
    expect(stored).toBeDefined();
    expect(stored["7"]).toBeDefined();
    expect(typeof stored["7"]).toBe("number");
  });

  it("persists nav context without minting navigation authority", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");
    await flushAsync();

    mock.dispatchRuntimeMessage(
      { type: "ns-nav-context", url: "https://spoofed.test/" },
      { tab: { id: 9, url: "https://origin.test/page" }, frameId: 0 },
    );
    await flushAsync();

    expect(mock.sessionStore["ns_sw:lastUrl"]).toEqual({ "9": "https://origin.test/page" });
    expect(mock.sessionStore["ns_sw:gestureUntil"]).toBeUndefined();
    expect(mock.sessionStore["ns_sw:allowUntil"]).toBeUndefined();
    expect(mock.sessionStore["ns_sw:allowTarget"]).toBeUndefined();
    expect(mock.sessionStore["ns_sw:userNavContextUntil"]).toBeUndefined();

    mock.dispatchRuntimeMessage(
      { type: "ns-nav-context", url: "https://child-spoofed.test/" },
      { tab: { id: 9, url: "https://top.test/" }, frameId: 2 },
    );
    await flushAsync();
    expect(mock.sessionStore["ns_sw:lastUrl"]).toEqual({ "9": "https://top.test/" });
    expect(mock.sessionStore["ns_sw:gestureUntil"]).toBeUndefined();
    expect(mock.sessionStore["ns_sw:allowUntil"]).toBeUndefined();
    expect(mock.sessionStore["ns_sw:allowTarget"]).toBeUndefined();
    expect(mock.sessionStore["ns_sw:userNavContextUntil"]).toBeUndefined();
  });

  it("persists allow-nav state to session storage", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");
    await flushAsync();

    mock.dispatchRuntimeMessage(
      { type: "ns-allow-nav", ttlMs: 2000 },
      { tab: { id: 11 } },
    );
    await flushAsync();

    const stored = mock.sessionStore["ns_sw:allowUntil"] as Record<string, number>;
    expect(stored).toBeDefined();
    expect(stored["11"]).toBeDefined();
  });

  it("persists childWindow state when a tab with opener is created", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");
    await flushAsync();

    mock.emitTabCreated({ id: 20, openerTabId: 10 });
    await flushAsync();

    const stored = mock.sessionStore["ns_sw:childWindow"] as Record<string, unknown>;
    expect(stored).toBeDefined();
    expect(stored["20"]).toBeDefined();
  });

  it("cleans up session storage when a tab is removed", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");
    await flushAsync();

    // Add some state for tab 30
    mock.dispatchRuntimeMessage(
      { type: "ns-allow-nav", ttlMs: 5000 },
      { tab: { id: 30 } },
    );
    mock.dispatchRuntimeMessage(
      { type: "ns-nav-gesture", ttlMs: 5000 },
      { tab: { id: 30 } },
    );
    await flushAsync();

    // Verify state exists
    const beforeAllow = mock.sessionStore["ns_sw:allowUntil"] as Record<string, number>;
    expect(beforeAllow["30"]).toBeDefined();

    // Remove the tab
    mock.emitTabRemoved(30);
    await flushAsync();

    // Verify state was cleaned up
    const afterAllow = mock.sessionStore["ns_sw:allowUntil"] as Record<string, number>;
    expect(afterAllow["30"]).toBeUndefined();
  });

  it("persists committed navigation state for rollback detection", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");
    await flushAsync();

    // Commit a typed navigation to establish origin
    mock.emitCommitted({
      tabId: 50,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: [],
    });
    await flushAsync();

    // Check that lastUrl was persisted
    const lastUrl = mock.sessionStore["ns_sw:lastUrl"] as Record<string, string>;
    expect(lastUrl["50"]).toBe("https://example.test/origin");

    // Check that typedOrigin was persisted
    const typedOrigin = mock.sessionStore["ns_sw:typedOrigin"] as Record<string, unknown>;
    expect(typedOrigin["50"]).toBeDefined();
  });
});
