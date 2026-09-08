import { spawn } from "node:child_process";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCorpusManifest,
  snapshotFilename,
  type CorpusManifestSuccessEntry,
} from "../../scripts/corpus-manifest.mjs";

const TEST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_PATH = join(TEST_ROOT, "scripts", "fetch-phishing-corpus.mjs");
const FETCH_DATE = "2026-09-03T12:00:00.000Z";
const temporaryDirectories: string[] = [];

interface Route {
  body?: Uint8Array | string;
  location?: string;
  statusCode?: number;
}

interface LoopbackServer {
  baseUrl: string;
  requests: string[];
  close(): Promise<void>;
}

interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeDirectory(): { root: string; manifestPath: string; outputDir: string } {
  const root = mkdtempSync(join(tmpdir(), "navsentinel-corpus-cli-"));
  temporaryDirectories.push(root);
  return {
    root,
    manifestPath: join(root, "manifest.json"),
    outputDir: join(root, "snapshots"),
  };
}

function manifestEntry(url: string, bytes: Uint8Array, source: "openphish" | "phishtank" = "openphish"): CorpusManifestSuccessEntry {
  return {
    filename: snapshotFilename(source, url),
    url,
    source,
    fetchDate: FETCH_DATE,
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
  };
}

function writeManifest(manifestPath: string, entries: CorpusManifestSuccessEntry[]): string {
  const raw = JSON.stringify(createCorpusManifest({
    generatedAt: FETCH_DATE,
    feedSources: [...new Set(entries.map((entry) => entry.source))],
    entries,
  }), null, 2);
  writeFileSync(manifestPath, raw, "utf8");
  return raw;
}

async function startLoopbackServer(routes: Record<string, Route>): Promise<LoopbackServer> {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    const pathname = request.url ?? "/";
    requests.push(pathname);
    const route = routes[pathname];
    if (!route) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    if (route.location) {
      response.statusCode = route.statusCode ?? 302;
      response.setHeader("location", route.location);
      response.end();
      return;
    }
    const body = Buffer.from(route.body ?? "");
    response.statusCode = route.statusCode ?? 200;
    response.setHeader("content-length", body.length);
    response.end(body);
  });

  await new Promise<void>((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveServer());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Loopback server did not expose an address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolveServer, reject) => {
      server.close((error) => error ? reject(error) : resolveServer());
    }),
  };
}

function runCli(manifestPath: string, outputDir: string): Promise<CliResult> {
  const child = spawn(process.execPath, [
    CLI_PATH,
    "--from-manifest",
    manifestPath,
    "--output-dir",
    outputDir,
    "--timeout",
    "1000",
  ], {
    cwd: TEST_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  return new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({ code, signal, stdout, stderr }));
  });
}

function expectSafeFailure(result: CliResult, forbidden: string[], code: string): void {
  expect(result.code).toBe(1);
  expect(result.signal).toBeNull();
  const output = `${result.stdout}\n${result.stderr}`;
  expect(output).toContain(`TEST_INVALID:${code}`);
  for (const value of forbidden) expect(output).not.toContain(value);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
  }
});

describe("production corpus rehydration CLI transport", () => {
  it("publishes exact loopback bytes and preserves the input manifest", async () => {
    const server = await startLoopbackServer({ "/benign": { body: "<main>inert benign bytes</main>" } });
    try {
      const { manifestPath, outputDir } = makeDirectory();
      const bytes = Buffer.from("<main>inert benign bytes</main>");
      const entry = manifestEntry(`${server.baseUrl}/benign`, bytes);
      const originalManifest = writeManifest(manifestPath, [entry]);

      const result = await runCli(manifestPath, outputDir);

      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe("");
      expect(server.requests).toEqual(["/benign"]);
      expect(readFileSync(manifestPath, "utf8")).toBe(originalManifest);
      expect(readFileSync(join(outputDir, entry.filename))).toEqual(bytes);
    } finally {
      await server.close();
    }
  });

  it("rejects a redirect without contacting the redirect target", async () => {
    const server = await startLoopbackServer({
      "/redirect": { location: "/payload" },
      "/payload": { body: "redirect target must not be fetched" },
    });
    try {
      const { manifestPath, outputDir } = makeDirectory();
      const expected = Buffer.from("redirect target must not be fetched");
      writeManifest(manifestPath, [manifestEntry(`${server.baseUrl}/redirect`, expected)]);

      const result = await runCli(manifestPath, outputDir);

      expectSafeFailure(result, [server.baseUrl, manifestPath, outputDir, expected.toString()], "download_failed");
      expect(server.requests).toEqual(["/redirect"]);
      expect(existsSync(outputDir)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("rejects an oversized response before publishing it", async () => {
    const expected = Buffer.from("expected inert response");
    const oversized = Buffer.from(`${expected.toString()} plus an oversized secret marker`);
    const server = await startLoopbackServer({ "/oversized": { body: oversized } });
    try {
      const { manifestPath, outputDir } = makeDirectory();
      writeManifest(manifestPath, [manifestEntry(`${server.baseUrl}/oversized`, expected)]);

      const result = await runCli(manifestPath, outputDir);

      expectSafeFailure(result, [server.baseUrl, manifestPath, outputDir, oversized.toString()], "download_failed");
      expect(server.requests).toEqual(["/oversized"]);
      expect(existsSync(outputDir)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("rejects same-length digest mismatches with no destination", async () => {
    const expected = Buffer.from("expected digest bytes");
    const actual = Buffer.from(expected.map((byte) => byte ^ 1));
    const server = await startLoopbackServer({ "/mismatch": { body: actual } });
    try {
      const { manifestPath, outputDir } = makeDirectory();
      writeManifest(manifestPath, [manifestEntry(`${server.baseUrl}/mismatch`, expected)]);

      const result = await runCli(manifestPath, outputDir);

      expectSafeFailure(result, [server.baseUrl, manifestPath, outputDir, actual.toString()], "download_digest_mismatch");
      expect(server.requests).toEqual(["/mismatch"]);
      expect(existsSync(outputDir)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("removes staged bytes when a later production download fails", async () => {
    const firstBytes = Buffer.from("first exact inert bytes");
    const secondExpected = Buffer.from("second response that should not publish");
    const server = await startLoopbackServer({
      "/first": { body: firstBytes },
      "/second": { statusCode: 503, body: "transport failure body" },
    });
    try {
      const { root, manifestPath, outputDir } = makeDirectory();
      const originalManifest = writeManifest(manifestPath, [
        manifestEntry(`${server.baseUrl}/first`, firstBytes),
        manifestEntry(`${server.baseUrl}/second`, secondExpected, "phishtank"),
      ]);

      const result = await runCli(manifestPath, outputDir);

      expectSafeFailure(result, [server.baseUrl, manifestPath, outputDir, "transport failure body"], "download_failed");
      expect(server.requests).toEqual(["/first", "/second"]);
      expect(existsSync(outputDir)).toBe(false);
      expect(readFileSync(manifestPath, "utf8")).toBe(originalManifest);
      expect(readdirSync(root)).toEqual(["manifest.json"]);
    } finally {
      await server.close();
    }
  });
});
