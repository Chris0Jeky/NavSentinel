import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Device-code phishing: a website sends the user to an OAuth device sign-in page. The SW records
// a pending entry on the committed navigation and delivers it once the tab finishes loading.

type Message = { type: string; [key: string]: unknown };
type TabInfo = { url?: string; active?: boolean; status?: string };

function createEvent<T extends (...args: never[]) => unknown>() {
  const listeners: T[] = [];
  return {
    addListener(listener: T) { listeners.push(listener); },
    emit(...args: Parameters<T>) { return listeners.map((listener) => listener(...args)); },
  };
}

function storageArea() {
  const data: Record<string, unknown> = {};
  return {
    async get(keys?: string | string[]) {
      if (keys === undefined) return { ...data };
      return Object.fromEntries((typeof keys === "string" ? [keys] : keys)
        .filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(items: Record<string, unknown>) { Object.assign(data, items); },
    async remove(keys: string | string[]) {
      for (const key of typeof keys === "string" ? [keys] : keys) delete data[key];
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const LURE = "https://docs-share.example/view";
const DEVICE = "https://microsoft.com/devicelogin";
const ENDPOINTS = [
  DEVICE,
  "https://www.microsoft.com/devicelogin",
  "https://login.microsoftonline.com/common/oauth2/deviceauth",
  "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/deviceauth?user_code=X",
  "https://login.live.com/oauth20_remoteconnect.srf",
  "https://www.google.com/device",
  // What Chrome commits after google.com/device's server redirect (curl -IL, 2026-10-30).
  "https://accounts.google.com/o/oauth2/device/usercode",
  "https://github.com/login/device",
  // Signed out: github.com/login/device redirects here first.
  "https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Flogin%2Fdevice",
];

async function setup(opts: { active?: boolean } = {}) {
  const tabs = new Map<number, TabInfo>([
    [10, { url: LURE, active: true }],
    [30, { url: LURE, active: opts.active ?? true }],
  ]);
  const browser = {
    runtime: {
      id: "mock-id", lastError: undefined as { message: string } | undefined,
      getURL: (name: string) => `chrome-extension://mock-id/${name}`,
      onMessage: createEvent<(message: Message, sender: unknown, respond: () => void) => unknown>(),
      onInstalled: createEvent(), onStartup: createEvent(),
    },
    storage: { local: storageArea(), session: storageArea(), onChanged: createEvent() },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    },
    webNavigation: {
      onBeforeNavigate: createEvent(), onCommitted: createEvent<(d: unknown) => void>(), onErrorOccurred: createEvent(),
      onCreatedNavigationTarget: createEvent(),
      getAllFrames: vi.fn().mockResolvedValue([]),
    },
    tabs: {
      onCreated: createEvent<(tab: { id: number; openerTabId: number }) => void>(),
      onRemoved: createEvent<(tabId: number) => void>(),
      onUpdated: createEvent<(tabId: number, change: { status?: string }, tab: { id: number; active: boolean; url?: string }) => void>(),
      onActivated: createEvent<(info: { tabId: number }) => void>(),
      create: vi.fn().mockResolvedValue({}),
      get: vi.fn(async (id: number) => ({ id, ...tabs.get(id) })),
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn((_tabId: number, _message: Message, callback?: () => void) => { callback?.(); }),
    },
    windows: { onFocusChanged: createEvent<(windowId: number) => void>() },
  };
  vi.stubGlobal("chrome", browser);
  await import("../extension/src/sw/sw");
  const { swState } = await import("../extension/src/shared/session_state");
  await swState.hydrate();
  swState.lastUrlByTab.set(30, LURE);
  const commit = async (url: string, over: Record<string, unknown> = {}, tabId = 30) => {
    tabs.set(tabId, { ...tabs.get(tabId), url, active: tabs.get(tabId)?.active ?? true });
    browser.webNavigation.onCommitted.emit({
      frameId: 0, tabId, url, transitionType: "link", transitionQualifiers: [], ...over });
    await flush();
  };
  const complete = async (tabId = 30) => {
    const tab = tabs.get(tabId)!;
    browser.tabs.onUpdated.emit(tabId, { status: "complete" }, { id: tabId, active: tab.active!, url: tab.url! });
    await flush();
  };
  const warnings = () => browser.tabs.sendMessage.mock.calls.filter(([, m]) => m.type === "ns-tabnab-warning");
  return { browser, swState, commit, complete, warnings };
}

beforeEach(() => { vi.resetModules(); });
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("device-code phishing warning", () => {
  it.each(ENDPOINTS)("warns once the page loads after a link from a lure site to %s", async (endpoint) => {
    const { commit, complete, warnings, swState } = await setup();
    await commit(endpoint);
    expect(swState.tabnabPendingByTab.get(30)).toMatchObject({ origReg: "docs-share.example", k: 1 });
    expect(warnings()).toHaveLength(0);
    await complete();
    expect(warnings()).toEqual([[30, { type: "ns-tabnab-warning", from: "docs-share.example", kind: "devicecode" }, expect.any(Function)]]);
    expect(swState.tabnabPendingByTab.has(30)).toBe(false);
    await complete();
    expect(warnings()).toHaveLength(1);
  });

  it.each([
    { transitionType: "typed" },
    { transitionType: "auto_bookmark" },
    { transitionType: "link", transitionQualifiers: ["from_address_bar"] },
    { transitionType: "link", transitionQualifiers: ["forward_back"] },
  ])("ignores a user-chosen or history navigation %j", async (over) => {
    const { commit, swState } = await setup();
    await commit(DEVICE, over);
    expect(swState.tabnabPendingByTab.size).toBe(0);
  });

  it("ignores a navigation with no source page", async () => {
    const { commit, swState } = await setup();
    swState.lastUrlByTab.delete(30);
    await commit(DEVICE);
    expect(swState.tabnabPendingByTab.size).toBe(0);
    swState.lastUrlByTab.set(30, "chrome://newtab/");
    await commit(DEVICE);
    expect(swState.tabnabPendingByTab.size).toBe(0);
  });

  it.each([
    "https://learn.microsoft.com/en-us/entra",
    "https://portal.azure.com/",
    "https://microsoft.com/en-us",
    "https://login.microsoftonline.com/common/oauth2/authorize",
  ])("ignores the provider's own sign-in or docs page as the source (%s)", async (source) => {
    const { commit, swState } = await setup();
    swState.lastUrlByTab.set(30, source);
    await commit(DEVICE);
    expect(swState.tabnabPendingByTab.size).toBe(0);
  });

  it.each([
    ["https://outlook.office.com/mail/inbox", "office.com"],
    ["https://mail.google.com/mail/u/0/", "google.com"],
    ["https://www.google.com/url?q=https://microsoft.com/devicelogin", "google.com"],
    ["https://docs.google.com/document/d/x", "google.com"],
    ["https://github.com/someone/repo", "github.com"],
    ["https://accounts.google.com/signin", "google.com"],
  ])("warns for mail, hosted documents and other providers as the source (%s)", async (source, from) => {
    const { commit, swState } = await setup();
    swState.lastUrlByTab.set(30, source);
    await commit(DEVICE);
    expect(swState.tabnabPendingByTab.get(30)).toMatchObject({ origReg: from, k: 1 });
  });

  it("keeps the source through GitHub's sign-in step back to the device page", async () => {
    const { commit, complete, warnings } = await setup();
    await commit("https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Flogin%2Fdevice");
    await commit("https://github.com/login/device");
    await complete();
    expect(warnings()).toEqual([[30, { type: "ns-tabnab-warning", from: "docs-share.example", kind: "devicecode" }, expect.any(Function)]]);
  });

  it("warns for a lure on the device page's own provider (Docs to Google, a repo to GitHub)", async () => {
    for (const [source, target, from] of [
      ["https://docs.google.com/document/d/x", "https://accounts.google.com/o/oauth2/device/usercode", "google.com"],
      ["https://github.com/someone/repo", "https://github.com/login/device", "github.com"],
    ]) {
      const { commit, complete, warnings, swState } = await setup();
      swState.lastUrlByTab.set(30, source);
      await commit(target);
      await complete();
      expect(warnings()).toEqual([[30, { type: "ns-tabnab-warning", from, kind: "devicecode" }, expect.any(Function)]]);
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("does not treat look-alike GitHub return_to paths as the device page", async () => {
    const { commit, swState } = await setup();
    await commit("https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Flogin%2Fdevices");
    expect(swState.tabnabPendingByTab.size).toBe(0);
  });

  it("treats a blob: page as the site that made it", async () => {
    const { commit, swState } = await setup();
    swState.lastUrlByTab.set(30, "blob:https://evil.example/6c1c0d2e-0000-4000-8000-000000000000");
    await commit(DEVICE);
    expect(swState.tabnabPendingByTab.get(30)).toMatchObject({ origReg: "evil.example", k: 1 });
  });

  it("lets a later tab swap replace a device-code entry", async () => {
    const { browser, commit, swState } = await setup({ active: false });
    await commit(DEVICE);
    expect(swState.tabnabPendingByTab.get(30)?.k).toBe(1);
    browser.tabs.onCreated.emit({ id: 40, openerTabId: 30 });
    await flush();
    browser.runtime.onMessage.emit({ type: "ns-dblclick-opener-nav", url: "https://phish.example/", ts: Date.now() }, { tab: { id: 40 } }, () => {});
    await flush();
    expect(swState.tabnabPendingByTab.get(30)?.k).toBeUndefined();
  });

  it.each([
    "https://microsoft.com/en-us",
    "https://github.com/login",
    "https://github.com/login/devices",
    "https://www.google.com/devices",
    "https://login.microsoftonline.com/common/oauth2/authorize",
    "https://evil.example/devicelogin",
    "https://microsoft.com.evil.example/devicelogin",
  ])("ignores a non-device-code page %s", async (url) => {
    const { commit, swState } = await setup();
    await commit(url);
    expect(swState.tabnabPendingByTab.size).toBe(0);
  });

  it("takes the source from the opener of a new tab", async () => {
    const { browser, commit, complete, warnings, swState } = await setup();
    swState.lastUrlByTab.set(10, LURE);
    browser.tabs.onCreated.emit({ id: 20, openerTabId: 10 });
    await flush();
    await commit("https://github.com/login/device", {}, 20);
    await complete(20);
    expect(warnings()).toEqual([[20, { type: "ns-tabnab-warning", from: "docs-share.example", kind: "devicecode" }, expect.any(Function)]]);
  });

  it("keeps the entry until the content script can receive it", async () => {
    const { browser, commit, complete, warnings, swState } = await setup();
    await commit(DEVICE);
    browser.runtime.lastError = { message: "Receiving end does not exist" };
    await complete();
    browser.runtime.lastError = undefined;
    expect(warnings()).toHaveLength(1);
    expect(swState.tabnabPendingByTab.has(30)).toBe(true);
    await complete();
    expect(warnings()).toHaveLength(2);
    expect(swState.tabnabPendingByTab.has(30)).toBe(false);
  });

  it("waits for a background tab to be activated", async () => {
    const { browser, commit, complete, warnings } = await setup({ active: false });
    await commit(DEVICE);
    await complete();
    expect(warnings()).toHaveLength(0);
    browser.tabs.onActivated.emit({ tabId: 30 });
    await flush();
    expect(warnings()).toHaveLength(1);
  });

  it("clears the entry when the tab is removed", async () => {
    const { browser, commit, complete, warnings, swState } = await setup();
    await commit(DEVICE);
    browser.tabs.onRemoved.emit(30);
    expect(swState.tabnabPendingByTab.has(30)).toBe(false);
    await complete();
    expect(warnings()).toHaveLength(0);
  });

  it("does not carry the entry to a later navigation of the tab", async () => {
    const { commit, complete, warnings, swState } = await setup();
    await commit(DEVICE);
    await commit("https://login.bank.example/");
    expect(swState.tabnabPendingByTab.has(30)).toBe(false);
    await complete();
    expect(warnings()).toHaveLength(0);
  });

  it("keeps a reverse-tabnabbing entry across a navigation of its tab", async () => {
    const { commit, swState } = await setup();
    swState.tabnabPendingByTab.set(30, { origReg: "bank.example", ts: Date.now() });
    await commit("https://login.bank-example.test/");
    expect(swState.tabnabPendingByTab.get(30)).toMatchObject({ origReg: "bank.example" });
  });

  it("bounds the pending map", async () => {
    const { commit, swState } = await setup();
    for (let i = 100; i < 150; i++) swState.tabnabPendingByTab.set(i, { origReg: "x.example", ts: Date.now() });
    await commit(DEVICE);
    expect(swState.tabnabPendingByTab.size).toBe(50);
    expect(swState.tabnabPendingByTab.has(100)).toBe(false);
    expect(swState.tabnabPendingByTab.has(30)).toBe(true);
  });
});
