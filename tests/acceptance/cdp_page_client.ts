/**
 * Minimal DevTools client for extension pages Playwright does not attach to.
 *
 * Chrome opens the toolbar popup (`chrome.action.openPopup()`) as a separate
 * page target that Playwright's persistent context never adopts, so the
 * acceptance lane drives it over the browser's remote-debugging port instead.
 * `Input.dispatch*` events arrive as trusted input with user activation, the
 * same path a person's mouse and keyboard take through the renderer.
 */
import fs from "node:fs";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type TargetInfo = { id: string; type: string; url: string; webSocketDebuggerUrl?: string };

export type ConsoleRecord = { source: string; level: string; text: string; at: string };

type KeyDefinition = { key: string; code: string; keyCode: number; text?: string };
export type KeyName = "Tab" | "Enter" | "Space" | "Escape" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

const KEY_DEFINITIONS: Record<KeyName, KeyDefinition> = {
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
};

export async function listTargets(port: number): Promise<TargetInfo[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`DevTools target list unavailable on port ${port}`);
  return (await response.json()) as TargetInfo[];
}

/** Port Chrome chose for `--remote-debugging-port=0`, read from the profile. */
export async function readDevToolsPort(userDataDir: string, timeoutMs = 10_000): Promise<number> {
  const file = `${userDataDir}/DevToolsActivePort`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const port = Number(fs.readFileSync(file, "utf8").split(/\r?\n/)[0]);
      if (Number.isInteger(port) && port > 0) return port;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chrome did not publish a DevTools port");
}

export class CdpPageClient {
  private socket: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  readonly console: ConsoleRecord[] = [];
  readonly url: string;
  readonly targetId: string;

  private constructor(socket: WebSocket, target: TargetInfo, private readonly label: string) {
    this.socket = socket;
    this.url = target.url;
    this.targetId = target.id;
    socket.addEventListener("message", (event) => this.onMessage(String(event.data)));
    socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error(`${label} DevTools socket closed`));
      this.pending.clear();
    });
  }

  static async attach(port: number, match: (target: TargetInfo) => boolean, label: string, timeoutMs = 8000, targetType = "page"): Promise<CdpPageClient> {
    const deadline = Date.now() + timeoutMs;
    let target: TargetInfo | undefined;
    while (!target && Date.now() < deadline) {
      target = (await listTargets(port)).find((candidate) => candidate.type === targetType && match(candidate));
      if (!target) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!target?.webSocketDebuggerUrl) throw new Error(`${label} target did not appear`);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error(`${label} DevTools socket failed`)), { once: true });
    });
    const client = new CdpPageClient(socket, target, label);
    await client.send("Runtime.enable");
    if (targetType === "page") {
      await client.send("Log.enable");
      await client.send("Page.enable");
    }
    return client;
  }

  private onMessage(raw: string): void {
    const message = JSON.parse(raw) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> };
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    const at = new Date().toISOString();
    if (message.method === "Runtime.consoleAPICalled") {
      const params = message.params as { type: string; args: Array<{ value?: unknown; description?: string }> };
      const text = params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ");
      this.console.push({ source: this.label, level: params.type, text, at });
    } else if (message.method === "Runtime.exceptionThrown") {
      const details = (message.params as { exceptionDetails: { text: string; exception?: { description?: string } } }).exceptionDetails;
      this.console.push({ source: this.label, level: "exception", text: details.exception?.description ?? details.text, at });
    } else if (message.method === "Log.entryAdded") {
      const entry = (message.params as { entry: { level: string; text: string; url?: string } }).entry;
      this.console.push({ source: this.label, level: entry.level, text: `${entry.text}${entry.url ? ` (${entry.url})` : ""}`, at });
    }
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    // A closed WHATWG WebSocket may discard send() without throwing. The close
    // event may already have fired, leaving a newly registered request pending.
    if (this.closed) return Promise.reject(new Error(`${this.label} DevTools socket closed before ${method}`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression (or an arrow-function source applied to `arg`) in the page. */
  async evaluate<T>(source: string | ((arg: never) => unknown), arg?: unknown): Promise<T> {
    const expression = typeof source === "function"
      ? `(${source.toString()})(${JSON.stringify(arg ?? null)})`
      : source;
    const result = await this.send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true, userGesture: false },
    );
    if (result.exceptionDetails) {
      throw new Error(`${this.label} evaluate failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result.value as T;
  }

  async waitFor(predicateSource: string, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let satisfied: boolean;
      try {
        satisfied = await this.evaluate<boolean>(`Boolean(${predicateSource})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.closed || /DevTools socket closed/i.test(message)) {
          throw new Error(`${this.label}: DevTools socket closed while waiting for ${predicateSource}: ${message}`, { cause: error });
        }
        if (message.includes(`${this.label} evaluate failed:`)) {
          // The predicate threw in the page before render (for example a
          // missing element without optional chaining); poll again as not-yet-true.
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        throw error;
      }
      if (satisfied) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${this.label}: timed out waiting for ${predicateSource}`);
  }

  async centerOf(selector: string): Promise<{ x: number; y: number }> {
    const point = await this.evaluate<{ x: number; y: number } | null>((sel: string) => {
      const element = document.querySelector(sel);
      if (!element) return null;
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, selector as never);
    if (!point) throw new Error(`${this.label}: ${selector} is not rendered`);
    return point;
  }

  /** One trusted left click at the element's centre. */
  async click(selector: string, clickCount = 1): Promise<void> {
    const { x, y } = await this.centerOf(selector);
    await this.clickAt(x, y, clickCount);
  }

  async clickAt(x: number, y: number, clickCount = 1): Promise<void> {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    for (let count = 1; count <= clickCount; count += 1) {
      await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: count });
      await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: count });
    }
  }

  async press(name: KeyName, modifiers = 0): Promise<void> {
    const key = KEY_DEFINITIONS[name];
    await this.send("Input.dispatchKeyEvent", {
      type: key.text ? "keyDown" : "rawKeyDown",
      key: key.key,
      code: key.code,
      windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode,
      modifiers,
      ...(key.text ? { text: key.text, unmodifiedText: key.text } : {}),
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: key.key,
      code: key.code,
      windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode,
      modifiers,
    });
  }

  async screenshot(file: string): Promise<void> {
    const { data } = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) {
      await this.send("Page.close").catch(() => undefined);
      this.socket.close();
    }
  }

  get closed(): boolean {
    return this.socket.readyState !== WebSocket.OPEN;
  }
}
