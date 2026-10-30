// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * capture_isolated's ClickFix wiring for the lazy clipboard neutralizer (#1169),
 * driven through the REAL bridge client (harness as in
 * capture-bridge-handshake.test.ts). The warning toast and event must stay
 * synchronous and unchanged whatever the neutralizer does, and only the
 * receipt that is itself command-like may reach it.
 */

const NS_SOURCE = "__navsentinel__";
// The existing ClickFix warning: the dialog wording, or the overlay-free wording from #1182.
const WARNING = /^Heedline (detected a fake verification dialog|saw this page copy a command)/;

const appendEvent = vi.fn(async (_entry: unknown) => {});
const showToast = vi.fn((_opts: { message: string }) => {});
const onClickFixReceipt = vi.fn(async (_input: unknown): Promise<boolean> => {
  throw new Error("neutralizer failed");
});

vi.mock("../extension/src/shared/storage", async (original) => {
  const mod = await original<typeof import("../extension/src/shared/storage")>();
  return {
    ...mod,
    getNavSettings: async () => ({ defaultMode: "smart", debug: false, autoDismissOverlays: false }),
    onNavSettingsChange: () => {},
    appendEvent: (entry: unknown) => appendEvent(entry),
    appendPromptOutcome: vi.fn(async () => {}),
  };
});
vi.mock("../extension/src/content/ui_toast", async (original) => {
  const mod = await original<typeof import("../extension/src/content/ui_toast")>();
  return { ...mod, showToast: (opts: { message: string }) => showToast(opts) };
});
vi.mock("../extension/src/content/clipboard_neutralizer", () => ({
  onClickFixReceipt: (input: unknown) => onClickFixReceipt(input),
}));
vi.mock("../extension/src/shared/allowlist", async (original) => {
  const mod = await original<typeof import("../extension/src/shared/allowlist")>();
  return { ...mod, getAllowlist: async () => ({}), onAllowlistChange: () => {} };
});
vi.mock("../extension/src/shared/adaptive_scoring", async (original) => {
  const mod = await original<typeof import("../extension/src/shared/adaptive_scoring")>();
  return { ...mod, getEffectiveThresholdAdjustment: async () => 0 };
});
vi.mock("../extension/src/content/chain_info_cache", async (original) => {
  const mod = await original<typeof import("../extension/src/content/chain_info_cache")>();
  return { ...mod, primeChainInfoCache: () => {}, getFreshChainInfo: () => null, handleChainInfoPageShow: () => {} };
});

interface BridgeMessage { source?: string; type?: string; v?: number; session?: string; [key: string]: unknown }

const inits: Array<{ data: BridgeMessage; port: MessagePort }> = [];
let realPostMessage!: typeof window.postMessage;
let warn: ReturnType<typeof vi.spyOn>;

async function waitFor(condition: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function latest() {
  return inits[inits.length - 1]!;
}

function sendWrite(looksLikeCommand: boolean): void {
  const { data, port } = latest();
  port.postMessage({
    source: NS_SOURCE, type: "ns-clipboard-write", v: 1, session: data.session,
    ts: Date.now(), contentLength: 40, looksLikeCommand,
  });
}

beforeAll(async () => {
  vi.stubGlobal("chrome", {
    storage: { onChanged: { addListener: () => {} }, local: { get: async () => ({}), set: async () => {} } },
    runtime: {
      sendMessage: (...args: unknown[]) => (typeof args[args.length - 1] === "function" ? undefined : Promise.resolve({})),
      onMessage: { addListener: () => {} },
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getManifest: () => ({ version: "test" }),
      id: "test-id",
      lastError: undefined,
    },
  });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  realPostMessage = window.postMessage.bind(window);
  window.postMessage = ((data: BridgeMessage, origin: string, transfer?: MessagePort[]) => {
    if (data?.type === "ns-port-init" && transfer?.[0]) inits.push({ data, port: transfer[0] });
    return realPostMessage(data, origin);
  }) as typeof window.postMessage;
  // Lure text with no layout: happy-dom gives the text-pattern detection only.
  document.body.innerHTML = "<div>Verify you are human: press Win+R, then Ctrl+V and press Enter</div>";
  await import("../extension/src/content/capture_isolated");
  const { data, port } = latest();
  port.postMessage({ source: NS_SOURCE, type: "ns-bridge-ready", v: 1, session: data.session });
  await waitFor(() => document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1", "bridge ready");
  // Let initSettings apply the mocked Smart mode.
  await new Promise((resolve) => setTimeout(resolve, 50));
});

afterAll(() => {
  window.postMessage = realPostMessage;
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("ClickFix clipboard neutralizer wiring (#1169)", () => {
  it("keeps the existing warning when the neutralizer fails, and passes the current receipt", async () => {
    sendWrite(true);
    await waitFor(() => showToast.mock.calls.length > 0, "warning toast");
    expect(showToast.mock.calls[0]![0].message).toMatch(WARNING);
    await waitFor(() => onClickFixReceipt.mock.calls.length === 1, "neutralizer call");
    expect(onClickFixReceipt.mock.calls[0]![0]).toMatchObject({ command: true, mode: "smart", detected: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledTimes(1);
    const entry = appendEvent.mock.calls[0]![0] as { kind: string; reasons: string[] };
    expect(entry.kind).toBe("clickfix_detected");
    expect(entry.reasons).not.toContain("clipboard_neutralized");
  });

  it("never sends a benign receipt to the neutralizer, even after a command write", async () => {
    sendWrite(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onClickFixReceipt).toHaveBeenCalledTimes(1);
  });
});
