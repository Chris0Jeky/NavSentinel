import { createHash } from "node:crypto";
import * as http from "node:http";

export const PROVING_GROUND_SENTINEL = "NAVSENTINEL_SENTINEL_DO_NOT_RUN";
export const PROVING_GROUND_SINK_PATH = "/__navsentinel_fake_sink";

const SAFE_SINK_PORT_START = 46100;
const SAFE_SINK_PORT_ATTEMPTS = 25;

export type ProvingGroundRole = "attack" | "benign" | "mixed";

export type ProvingGroundSinkReceipt = {
  sequence: number;
  runId: string;
  scenarioId: string;
  role: ProvingGroundRole;
  consequence: string;
  method: "GET";
  sentinelSha256: string;
  receivedAt: string;
};

export type ProvingGroundSinkSnapshot = {
  receipts: ProvingGroundSinkReceipt[];
  invalidAttempts: Array<{ reason: string; receivedAt: string }>;
};

export type ProvingGroundFakeSink = {
  origin: string;
  urlFor: (role: ProvingGroundRole, consequence: string) => string;
  snapshot: () => ProvingGroundSinkSnapshot;
  close: () => Promise<void>;
};

export type ProvingGroundEgressAttempt = {
  method: string;
  target: string;
  count: number;
};

export type ProvingGroundEgressFence = {
  proxyServer: string;
  close: () => Promise<void>;
};

type FakeSinkOptions = {
  runId: string;
  scenarioId: string;
  allowedRoles: readonly ProvingGroundRole[];
  allowedConsequences: readonly string[];
};

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function writeInertResponse(
  res: http.ServerResponse,
  statusCode: number,
  title: string,
  detail: string,
): void {
  res.statusCode = statusCode;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:48rem;margin:3rem auto;padding:0 1rem}</style>
</head><body><h1>${title}</h1><p>${detail}</p></body></html>`);
}

async function bindLoopback(server: http.Server): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < SAFE_SINK_PORT_ATTEMPTS; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(SAFE_SINK_PORT_START + attempt, "127.0.0.1");
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Failed to bind the Proving Ground fake sink to loopback");
}

async function bindEphemeralLoopback(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

export async function startProvingGroundEgressFence(
  attempts: ProvingGroundEgressAttempt[],
  allowedOrigins: ReadonlySet<string> = new Set(),
): Promise<ProvingGroundEgressFence> {
  const recordAttempt = (method: string, target: string): void => {
    const existing = attempts.find((attempt) =>
      attempt.method === method && attempt.target === target,
    );
    if (existing) existing.count += 1;
    else attempts.push({ method, target, count: 1 });
  };
  const server = http.createServer((req, res) => {
    let target: URL | null = null;
    try {
      target = new URL(req.url ?? "");
    } catch {
      // A proxy request must carry an absolute URL. Anything else fails closed.
    }

    if (target?.protocol === "http:" && allowedOrigins.has(target.origin)) {
      const headers = { ...req.headers };
      delete headers["proxy-connection"];
      const upstream = http.request(target, {
        method: req.method,
        headers,
      }, (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(res);
      });
      upstream.once("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end("Proving Ground loopback forwarding failed.\n");
      });
      req.pipe(upstream);
      return;
    }

    recordAttempt(
      req.method ?? "UNKNOWN",
      target ? `${target.origin}${target.pathname}` : "unknown",
    );
    res.statusCode = 403;
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Proving Ground denied non-loopback HTTP egress.\n");
  });
  server.on("connect", (req, socket) => {
    recordAttempt("CONNECT", req.url ?? "unknown");
    socket.on("error", () => {
      // Chromium may reset a denied CONNECT tunnel while the 403 is flushing.
    });
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });

  await bindEphemeralLoopback(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Proving Ground egress fence did not expose a TCP address");
  }

  return {
    proxyServer: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolve());
    }),
  };
}

export async function startProvingGroundFakeSink(
  options: FakeSinkOptions,
): Promise<ProvingGroundFakeSink> {
  const allowedRoles = new Set(options.allowedRoles);
  const allowedConsequences = new Set(options.allowedConsequences);
  const receipts: ProvingGroundSinkReceipt[] = [];
  const invalidAttempts: ProvingGroundSinkSnapshot["invalidAttempts"] = [];
  const sentinelSha256 = digest(PROVING_GROUND_SENTINEL);

  const reject = (res: http.ServerResponse, reason: string, statusCode = 400): void => {
    invalidAttempts.push({ reason, receivedAt: new Date().toISOString() });
    writeInertResponse(res, statusCode, "Synthetic sink rejected the request", reason);
  };

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET") {
      reject(res, "Only an inert GET consequence is accepted", 405);
      return;
    }
    if (reqUrl.pathname !== PROVING_GROUND_SINK_PATH) {
      reject(res, "Unknown sink path", 404);
      return;
    }

    const runId = reqUrl.searchParams.get("run_id") ?? "";
    const scenarioId = reqUrl.searchParams.get("scenario_id") ?? "";
    const role = reqUrl.searchParams.get("role") ?? "";
    const consequence = reqUrl.searchParams.get("consequence") ?? "";
    const sentinel = reqUrl.searchParams.get("sentinel") ?? "";

    if (runId !== options.runId) {
      reject(res, "Run identifier is not armed");
      return;
    }
    if (scenarioId !== options.scenarioId) {
      reject(res, "Scenario identifier is not allowlisted");
      return;
    }
    if (!allowedRoles.has(role as ProvingGroundRole)) {
      reject(res, "Fixture role is not allowlisted");
      return;
    }
    if (!allowedConsequences.has(consequence)) {
      reject(res, "Consequence type is not allowlisted");
      return;
    }
    if (sentinel !== PROVING_GROUND_SENTINEL) {
      reject(res, "Only the exact synthetic sentinel is accepted");
      return;
    }

    receipts.push({
      sequence: receipts.length + 1,
      runId,
      scenarioId,
      role: role as ProvingGroundRole,
      consequence,
      method: "GET",
      sentinelSha256,
      receivedAt: new Date().toISOString(),
    });
    writeInertResponse(
      res,
      200,
      "Synthetic consequence received",
      "The local fake sink recorded an inert sentinel. No external action was attempted.",
    );
  });

  await bindLoopback(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Proving Ground fake sink did not expose a TCP address");
  }
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    urlFor: (role, consequence) => {
      if (!allowedRoles.has(role)) throw new Error(`Fixture role is not armed: ${role}`);
      if (!allowedConsequences.has(consequence)) {
        throw new Error(`Consequence is not armed: ${consequence}`);
      }
      const url = new URL(PROVING_GROUND_SINK_PATH, origin);
      url.searchParams.set("run_id", options.runId);
      url.searchParams.set("scenario_id", options.scenarioId);
      url.searchParams.set("role", role);
      url.searchParams.set("consequence", consequence);
      url.searchParams.set("sentinel", PROVING_GROUND_SENTINEL);
      return url.href;
    },
    snapshot: () => ({
      receipts: receipts.map((receipt) => ({ ...receipt })),
      invalidAttempts: invalidAttempts.map((attempt) => ({ ...attempt })),
    }),
    close: () => new Promise<void>((resolve, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolve());
    }),
  };
}
