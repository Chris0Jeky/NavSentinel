import fs from "fs";
import * as http from "node:http";
import path from "path";
import type { BrowserContext, Page, Worker } from "@playwright/test";

type GymServerHandle = { baseUrl: string; close: () => Promise<void> };

export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent("serviceworker");
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  const worker = await getServiceWorker(context);
  return new URL(worker.url()).host;
}

export async function waitForNavSentinelBridge(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    () =>
      document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
      document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1",
    null,
    { timeout }
  );
}

export async function waitForToastText(page: Page, text: string, timeout = 4000): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const host = document.querySelector("#__navsentinel_toast_host");
      const root = host?.shadowRoot;
      return !!root?.textContent?.includes(expected);
    },
    text,
    { timeout }
  );
}

export function getGymBaseUrlOverride(): string | undefined {
  const raw = process.env.GYM_BASE_URL?.trim();
  return raw ? raw : undefined;
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function startGymServer(gymRoot: string): Promise<GymServerHandle> {
  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(reqUrl.pathname);
      const rel = pathname === "/" ? "/index.html" : pathname;
      const resolved = path.resolve(gymRoot, `.${rel}`);

      if (!isWithinRoot(gymRoot, resolved)) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }

      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      if (ext === ".css") res.setHeader("content-type", "text/css; charset=utf-8");
      else if (ext === ".js") res.setHeader("content-type", "text/javascript; charset=utf-8");
      else res.setHeader("content-type", "text/html; charset=utf-8");

      const delayMs = Number(reqUrl.searchParams.get("delayMs") ?? "0");
      if (Number.isFinite(delayMs) && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      res.statusCode = 200;
      res.end(fs.readFileSync(resolved));
    } catch {
      res.statusCode = 500;
      res.end("Server error");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind Gym server");

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

export async function getGymBaseUrl(
  gymRoot: string
): Promise<{ baseUrl: string; gym: GymServerHandle | null }> {
  const override = getGymBaseUrlOverride();
  if (override) {
    return { baseUrl: override, gym: null };
  }

  const gym = await startGymServer(gymRoot);
  return { baseUrl: gym.baseUrl, gym };
}
