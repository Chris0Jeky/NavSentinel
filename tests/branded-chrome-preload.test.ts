import { readFileSync } from "node:fs";
import * as realPath from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const SOURCE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "./branded/branded-chrome-preload.cjs",
);
const SOURCE = readFileSync(SOURCE_PATH, "utf8");
if (SOURCE.length === 0) {
  throw new Error(`branded preload source is empty: ${SOURCE_PATH}`);
}

const FEATURE_SWITCH = "--disable-features=AutomationControlled";
const VERSION = "142.0.0.0";

interface Harness {
  chromium: BrowserType;
  firefox: BrowserType;
  proto: BrowserPrototype;
  nativeOriginal: BrowserPrototype["launchPersistentContext"];
  nativeCalls: Array<{ receiver: unknown; userDataDir: string; options: LaunchOptions }>;
  contexts: FakeContext[];
  appended: Array<{ file: string; data: string }>;
  existsCalls: string[];
}

interface LaunchOptions {
  args?: string[];
  channel?: string;
  executablePath?: string;
  chromiumSandbox?: boolean;
  ignoreDefaultArgs?: boolean | string[];
  proxy?: { server: string };
}

interface BrowserPrototype {
  launchPersistentContext(userDataDir: string, options: LaunchOptions): Promise<FakeContext>;
  __navsentinelBrandedPatched?: boolean;
}

interface BrowserType extends BrowserPrototype { name(): string }
interface FakeSession {
  sendCalls: Array<{ method: string; params: unknown }>;
  readonly detachCalls: number;
  send(method: string, params: unknown): Promise<void>;
  detach(): Promise<void>;
}
interface FakeBrowser {
  version(): string;
  readonly sessionCreated: boolean;
  newBrowserCDPSession(): Promise<FakeSession>;
}
interface FakeContext {
  pages(): unknown[];
  browser(): FakeBrowser;
  closeCalls: number;
  close(): Promise<void>;
  __browser: FakeBrowser;
  __session: FakeSession;
}

function boot(
  env: Record<string, string>,
  hooks: { defaultChrome?: string; failSendWith?: unknown; failRecordWith?: unknown } = {},
): Harness {
  const nativeCalls: Harness["nativeCalls"] = [];
  const contexts: FakeContext[] = [];
  const appended: Harness["appended"] = [];
  const existsCalls: string[] = [];

  const fsMock = {
    existsSync: (candidate: string): boolean => {
      existsCalls.push(candidate);
      return hooks.defaultChrome !== undefined && candidate === hooks.defaultChrome;
    },
    appendFileSync: (file: string, data: string): void => {
      if (hooks.failRecordWith !== undefined) throw hooks.failRecordWith;
      appended.push({ file, data });
    },
  };

  const nativeOriginal = async function (
    this: unknown,
    userDataDir: string,
    options: LaunchOptions,
  ): Promise<FakeContext> {
    nativeCalls.push({ receiver: this, userDataDir, options });
    const sendCalls: Array<{ method: string; params: unknown }> = [];
    let detachCalls = 0;
    const session = {
      sendCalls,
      get detachCalls(): number {
        return detachCalls;
      },
      send: async (method: string, params: unknown): Promise<void> => {
        sendCalls.push({ method, params });
        if (hooks.failSendWith !== undefined) throw hooks.failSendWith;
      },
      detach: async (): Promise<void> => {
        detachCalls += 1;
      },
    };
    let sessionCreated = false;
    const browser = {
      version: (): string => VERSION,
      get sessionCreated(): boolean {
        return sessionCreated;
      },
      newBrowserCDPSession: async (): Promise<FakeSession> => {
        sessionCreated = true;
        return session;
      },
    };
    const context = {
      pages: (): unknown[] => [],
      browser: (): FakeBrowser => browser,
      closeCalls: 0,
      close: async function (this: FakeContext): Promise<void> {
        this.closeCalls += 1;
      },
      __browser: browser,
      __session: session,
    };
    contexts.push(context);
    return context;
  };
  const proto: BrowserPrototype = { launchPersistentContext: nativeOriginal };

  const chromium: BrowserType = Object.create(proto);
  chromium.name = (): string => "chromium";
  const firefox: BrowserType = Object.create(proto);
  firefox.name = (): string => "firefox";

  const mockRequire = Object.assign((id: string): unknown => {
    if (id === "node:fs") return fsMock;
    if (id === "node:path" || id === "path") return realPath;
    if (id === "playwright-core") return { chromium };
    if (id.endsWith("chromiumSwitches.js")) {
      return { chromiumSwitches: (): string[] => ["--x", FEATURE_SWITCH] };
    }
    throw new Error(`unexpected require(${id})`);
  }, { resolve: (id: string): string => {
    if (id === "playwright-core/package.json") {
      return realPath.join("/fake", "playwright-core", "package.json");
    }
    throw new Error(`unexpected require.resolve(${id})`);
  } });

  const sandbox = {
    process: { env: { ...env } },
    console,
    setTimeout,
    clearTimeout,
    require: mockRequire,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "branded-chrome-preload.cjs" });
  return { chromium, firefox, proto, nativeOriginal, nativeCalls, contexts, appended, existsCalls };
}

describe("branded-chrome-preload control parity (M0 #1018)", () => {
  it("control and extension arms share the resolved custom executable despite different channels", async () => {
    const custom = realPath.resolve("test-ext/custom-chrome/chrome");
    const harness = boot({ NAVSENTINEL_BRANDED_CHROME: `  ${custom}  ` });
    await harness.chromium.launchPersistentContext("/tmp/ud-control", {
      channel: "chrome",
      args: [],
    });
    const extPath = realPath.resolve("test-ext/ext-a");
    await harness.chromium.launchPersistentContext("/tmp/ud-ext", {
      args: [`--load-extension=${extPath}`],
    });
    expect(harness.nativeCalls).toHaveLength(2);
    const controlOpts = harness.nativeCalls[0]!.options;
    const extOpts = harness.nativeCalls[1]!.options;
    expect(controlOpts?.executablePath).toBe(custom);
    expect(extOpts?.executablePath).toBe(custom);
    expect(controlOpts?.channel).toBeUndefined();
    expect(extOpts?.channel).toBeUndefined();
  });

  it("default install selection applies to both arms", async () => {
    const base = realPath.resolve("fake-local");
    const selected = realPath.join(base, "Google", "Chrome", "Application", "chrome.exe");
    const harness = boot(
      { NAVSENTINEL_BRANDED_CHROME: "1", LOCALAPPDATA: base },
      { defaultChrome: selected },
    );
    await harness.chromium.launchPersistentContext("/tmp/ud-control", { args: [] });
    const extPath = realPath.resolve("test-ext/ext-b");
    await harness.chromium.launchPersistentContext("/tmp/ud-ext", {
      args: [`--load-extension=${extPath}`],
    });
    expect(harness.nativeCalls).toHaveLength(2);
    expect(harness.nativeCalls[0]?.options?.executablePath).toBe(selected);
    expect(harness.nativeCalls[1]?.options?.executablePath).toBe(selected);
  });

  it("record captures both arms and control performs no extension loading", async () => {
    const custom = realPath.resolve("test-ext/custom-chrome/chrome");
    const recordFile = realPath.resolve("fake-record.jsonl");
    const harness = boot({
      NAVSENTINEL_BRANDED_CHROME: custom,
      NAVSENTINEL_BRANDED_RECORD: recordFile,
    });
    await harness.chromium.launchPersistentContext("/tmp/ud-control", { args: [] });
    const extPath = realPath.resolve("test-ext/ext-c");
    await harness.chromium.launchPersistentContext("/tmp/ud-ext", {
      args: [`--load-extension=${extPath}`],
    });
    expect(harness.appended).toHaveLength(2);
    expect(harness.appended[0]?.file).toBe(recordFile);
    const first = JSON.parse(harness.appended[0]?.data ?? "");
    const second = JSON.parse(harness.appended[1]?.data ?? "");
    expect(first.executablePath).toBe(custom);
    expect(second.executablePath).toBe(custom);
    expect(first.extensions).toEqual([]);
    expect(second.extensions).toEqual([extPath]);
    expect(first.version).toBe(VERSION);
    expect(second.version).toBe(VERSION);
    expect(harness.contexts[0]?.__session.sendCalls).toEqual([]);
    expect(harness.contexts[0]?.__browser.sessionCreated).toBe(false);
    expect(second.realistic).toBe(false);
  });

  it("realistic mode shares launch flags, sandbox, proxy and ignoreDefaultArgs across arms", async () => {
    const custom = realPath.resolve("test-ext/custom-chrome/chrome");
    const recordFile = realPath.resolve("fake-record.jsonl");
    const proxy = { server: "http://127.0.0.1:8080" };
    const harness = boot({
      NAVSENTINEL_BRANDED_CHROME: custom,
      NAVSENTINEL_REALISTIC_CHROME: "1",
      NAVSENTINEL_BRANDED_RECORD: recordFile,
    });
    await harness.chromium.launchPersistentContext("/tmp/ud-control", {
      proxy,
      ignoreDefaultArgs: ["--existing"],
      args: ["--kept=1"],
    });
    const extPath = realPath.resolve("test-ext/ext-d");
    await harness.chromium.launchPersistentContext("/tmp/ud-ext", {
      proxy,
      ignoreDefaultArgs: ["--existing"],
      args: ["--kept=1", `--load-extension=${extPath}`],
    });
    expect(harness.nativeCalls).toHaveLength(2);
    const controlOpts = harness.nativeCalls[0]!.options;
    const extOpts = harness.nativeCalls[1]!.options;
    for (const options of [controlOpts, extOpts]) {
      expect(options.chromiumSandbox).toBe(true);
      expect(options.proxy).toEqual(proxy);
      expect(options.executablePath).toBe(custom);
      expect(options.ignoreDefaultArgs).toEqual(
        expect.arrayContaining(["--existing", "--disable-extensions", FEATURE_SWITCH]),
      );
      expect(options.args).toEqual(
        expect.arrayContaining([
          "--kept=1",
          "--enable-unsafe-extension-debugging",
          "--no-first-run",
          "--no-default-browser-check",
        ]),
      );
    }
    expect(controlOpts.ignoreDefaultArgs).toEqual(extOpts.ignoreDefaultArgs);
    expect(controlOpts.args).toEqual(extOpts.args);
  });

  it("preserves ignoreDefaultArgs true", async () => {
    const custom = realPath.resolve("test-ext/custom-chrome/chrome");
    const harness = boot({ NAVSENTINEL_BRANDED_CHROME: custom });
    const extPath = realPath.resolve("test-ext/ext-e");
    await harness.chromium.launchPersistentContext("/tmp/ud-ext", {
      ignoreDefaultArgs: true,
      args: [`--load-extension=${extPath}`],
    });
    expect(harness.nativeCalls[0]?.options?.ignoreDefaultArgs).toBe(true);
  });

  it("strips extension flags and loads each unpacked extension over CDP", async () => {
    const custom = realPath.resolve("test-ext/custom-chrome/chrome");
    const harness = boot({ NAVSENTINEL_BRANDED_CHROME: custom });
    const firstExt = realPath.resolve("test-ext/a");
    const secondExt = realPath.resolve("test-ext/b");
    await harness.chromium.launchPersistentContext("/tmp/ud-ext", {
      args: [
        "--kept=1",
        `--load-extension=${firstExt},${secondExt}`,
        `--disable-extensions-except=${firstExt}`,
        "--other",
      ],
    });
    const options = harness.nativeCalls[0]!.options;
    expect(options.args?.join("\n")).not.toContain("--load-extension=");
    expect(options.args?.join("\n")).not.toContain("--disable-extensions-except=");
    expect(options.args).toEqual(
      expect.arrayContaining([
        "--kept=1",
        "--other",
        "--enable-unsafe-extension-debugging",
        "--no-first-run",
        "--no-default-browser-check",
      ]),
    );
    const session = harness.contexts[0]!.__session;
    expect(session.sendCalls).toEqual([
      { method: "Extensions.loadUnpacked", params: { path: firstExt } },
      { method: "Extensions.loadUnpacked", params: { path: secondExt } },
    ]);
    expect(session.detachCalls).toBe(1);
  });

  it.each(["unset", "", "   ", "0", " 0 "] as const)(
    "inactive selector %s leaves launch untouched and resolves no Chrome",
    async (selector) => {
      const env: Record<string, string> =
        selector === "unset" ? {} : { NAVSENTINEL_BRANDED_CHROME: selector };
      const harness = boot(env);
      expect(harness.proto.__navsentinelBrandedPatched).toBeFalsy();
      expect(harness.proto.launchPersistentContext).toBe(harness.nativeOriginal);
      const input = { args: ["--load-extension=/tmp/x"], channel: "chrome" };
      await harness.chromium.launchPersistentContext("/tmp/ud", input);
      expect(harness.nativeCalls[0]?.options).toBe(input);
      expect(harness.existsCalls).toEqual([]);
      expect(harness.appended).toEqual([]);
    },
  );

  it("non-Chromium launches stay on the original options in active mode", async () => {
    const custom = realPath.resolve("test-ext/custom-chrome/chrome");
    const harness = boot({ NAVSENTINEL_BRANDED_CHROME: custom });
    const input = { args: [`--load-extension=${realPath.resolve("test-ext/x")}`] };
    await harness.firefox.launchPersistentContext("/tmp/ud", input);
    expect(harness.nativeCalls[0]?.options).toBe(input);
    expect(harness.appended).toEqual([]);
  });

  it("failed extension load closes the context and rethrows", async () => {
    const failure = new Error("Extensions.loadUnpacked boom");
    const custom = realPath.resolve("test-ext/custom-chrome/chrome");
    const harness = boot({ NAVSENTINEL_BRANDED_CHROME: custom }, { failSendWith: failure });
    await expect(
      harness.chromium.launchPersistentContext("/tmp/ud-ext", {
        args: [`--load-extension=${realPath.resolve("test-ext/x")}`],
      }),
    ).rejects.toBe(failure);
    expect(harness.contexts[0]?.closeCalls).toBe(1);
  });

  it("failed control receipt closes the context and rethrows", async () => {
    const failure = new Error("record is unavailable");
    const harness = boot({
      NAVSENTINEL_BRANDED_CHROME: realPath.resolve("test-ext/custom-chrome/chrome"),
      NAVSENTINEL_BRANDED_RECORD: "fake-record.jsonl",
    }, { failRecordWith: failure });
    await expect(harness.chromium.launchPersistentContext("/tmp/ud-control", { args: [] }))
      .rejects.toBe(failure);
    expect(harness.contexts[0]?.closeCalls).toBe(1);
    expect(harness.contexts[0]?.__browser.sessionCreated).toBe(false);
  });
});
