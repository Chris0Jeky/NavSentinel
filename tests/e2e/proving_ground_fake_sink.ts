import { createHash } from "node:crypto";
import * as http from "node:http";

export const PROVING_GROUND_SENTINEL = "NAVSENTINEL_SENTINEL_DO_NOT_RUN";
export const PROVING_GROUND_SINK_PATH = "/__navsentinel_fake_sink";

const SAFE_SINK_PORT_START = 46100;
const SAFE_SINK_PORT_ATTEMPTS = 25;

export type ProvingGroundLoopbackHost = "127.0.0.1" | "127.0.0.2" | "::1";

export type ProvingGroundRole = "attack" | "benign" | "mixed";

export type ProvingGroundSinkReceipt = {
  sequence: number;
  runId: string;
  scenarioId: string;
  role: ProvingGroundRole;
  consequence: string;
  targetId?: string;
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
  scenarioId: string;
  urlFor: (role: ProvingGroundRole, consequence: string, targetId?: string) => string;
  createFixtureBootstrap: (input: FixtureBootstrapInput) => FixtureTargetBootstrap;
  snapshot: () => ProvingGroundSinkSnapshot;
  close: () => Promise<void>;
};

export type FixtureTargetRole = "harm" | "benign";
export type FixtureTargetOriginMode = "same-loopback" | "alternate-loopback";

export type FixtureBootstrapBinding = {
  targetRole: FixtureTargetRole;
  scenarioId: string;
  originMode?: FixtureTargetOriginMode;
  source:
    | { kind: "fallback" }
    | {
      kind: "armed-sink";
      sinkRole: ProvingGroundRole;
      consequence: string;
      targetId: string;
    };
};

export type FixtureBootstrapInput = {
  fixtureOrigin: string;
  fixturePath: string;
  bindings: readonly FixtureBootstrapBinding[];
};

export type FixtureTargetBootstrap = {
  fixtureOrigin: string;
  fixturePath: string;
  bindings: readonly {
    targetRole: FixtureTargetRole;
    scenarioId: string;
    originMode: FixtureTargetOriginMode;
    source: { kind: "fallback" } | { kind: "armed-sink"; href: string };
  }[];
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
  targetAuthorities?: readonly {
    id: string;
    role: ProvingGroundRole;
    consequence: string;
    maxUses: number;
  }[];
};

const FIXTURE_LOOPBACK_HOSTS = new Set(["127.0.0.1", "127.0.0.2", "localhost", "[::1]"]);
const FIXTURE_TARGET_ROLES = new Set<FixtureTargetRole>(["harm", "benign"]);
const FIXTURE_ORIGIN_MODES = new Set<FixtureTargetOriginMode>(["same-loopback", "alternate-loopback"]);
const FIXTURE_SINK_ROLES: Readonly<Record<FixtureTargetRole, ReadonlySet<ProvingGroundRole>>> = {
  harm: new Set(["attack", "mixed"]),
  benign: new Set(["benign", "mixed"]),
};

function normalizeFixtureOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Fixture origin must be a loopback HTTP origin");
  }
  if (parsed.protocol !== "http:" || !FIXTURE_LOOPBACK_HOSTS.has(parsed.hostname) ||
      parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password ||
      parsed.origin !== value) {
    throw new Error("Fixture origin must be a loopback HTTP origin");
  }
  return parsed.origin;
}

function normalizeFixturePath(value: string): string {
  if (!value.startsWith("/")) throw new Error("Fixture path must be an exact normalized absolute path");
  const parsed = new URL(value, "http://fixture.invalid");
  if (parsed.origin !== "http://fixture.invalid" || parsed.pathname !== value || parsed.search || parsed.hash) {
    throw new Error("Fixture path must be an exact normalized absolute path");
  }
  return parsed.pathname;
}

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

async function bindLoopback(server: http.Server, host: ProvingGroundLoopbackHost): Promise<void> {
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
        server.listen(SAFE_SINK_PORT_START + attempt, host);
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (host === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes((lastError as NodeJS.ErrnoException | null)?.code ?? "")) {
    throw new Error("unsupported-loopback-host-family");
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

export async function startProvingGroundFakeSinkForHost(
  host: ProvingGroundLoopbackHost,
  options: FakeSinkOptions,
): Promise<ProvingGroundFakeSink> {
  const allowedRoles = new Set(options.allowedRoles);
  const allowedConsequences = new Set(options.allowedConsequences);
  const targetAuthorities = new Map(
    (options.targetAuthorities ?? []).map((authority) => [authority.id, authority]),
  );
  if (targetAuthorities.size !== (options.targetAuthorities?.length ?? 0)) {
    throw new Error("Target authority identifiers must be unique");
  }
  for (const authority of targetAuthorities.values()) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(authority.id)) {
      throw new Error(`Target authority identifier is invalid: ${authority.id}`);
    }
    if (!allowedRoles.has(authority.role) || !allowedConsequences.has(authority.consequence)) {
      throw new Error(`Target authority is outside the sink allowlist: ${authority.id}`);
    }
    if (!Number.isSafeInteger(authority.maxUses) || authority.maxUses < 1) {
      throw new Error(`Target authority maxUses must be a positive integer: ${authority.id}`);
    }
  }
  const targetUses = new Map<string, number>();
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
    const targetId = reqUrl.searchParams.get("target_id") ?? "";
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
    if (targetAuthorities.size > 0) {
      const authority = targetAuthorities.get(targetId);
      if (!authority || authority.role !== role || authority.consequence !== consequence) {
        reject(res, "Target authority is not armed");
        return;
      }
      const uses = targetUses.get(targetId) ?? 0;
      if (uses >= authority.maxUses) {
        reject(res, "Target authority use count is exhausted", 409);
        return;
      }
      targetUses.set(targetId, uses + 1);
    } else if (targetId) {
      reject(res, "Unexpected target authority identifier");
      return;
    }

    receipts.push({
      sequence: receipts.length + 1,
      runId,
      scenarioId,
      role: role as ProvingGroundRole,
      consequence,
      ...(targetId ? { targetId } : {}),
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

  await bindLoopback(server, host);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Proving Ground fake sink did not expose a TCP address");
  }
  const originHost = host === "::1" ? "[::1]" : host;
  const origin = `http://${originHost}:${address.port}`;

  const urlFor = (role: ProvingGroundRole, consequence: string, targetId?: string): string => {
    if (!allowedRoles.has(role)) throw new Error(`Fixture role is not armed: ${role}`);
    if (!allowedConsequences.has(consequence)) {
      throw new Error(`Consequence is not armed: ${consequence}`);
    }
    if (targetAuthorities.size > 0) {
      const authority = targetAuthorities.get(targetId ?? "");
      if (!authority || authority.role !== role || authority.consequence !== consequence) {
        throw new Error(`Target authority is not armed: ${targetId ?? "missing"}`);
      }
    } else if (targetId) {
      throw new Error(`Target authority is not expected: ${targetId}`);
    }
    const url = new URL(PROVING_GROUND_SINK_PATH, origin);
    url.searchParams.set("run_id", options.runId);
    url.searchParams.set("scenario_id", options.scenarioId);
    url.searchParams.set("role", role);
    url.searchParams.set("consequence", consequence);
    if (targetId) url.searchParams.set("target_id", targetId);
    url.searchParams.set("sentinel", PROVING_GROUND_SENTINEL);
    return url.href;
  };

  const createFixtureBootstrap = (input: FixtureBootstrapInput): FixtureTargetBootstrap => {
    const fixtureOrigin = normalizeFixtureOrigin(input.fixtureOrigin);
    const fixturePath = normalizeFixturePath(input.fixturePath);
    const keys = new Set<string>();
    const bindings = input.bindings.map((binding) => {
      if (!FIXTURE_TARGET_ROLES.has(binding.targetRole)) {
        throw new Error(`Fixture target role is invalid: ${binding.targetRole}`);
      }
      if (binding.scenarioId !== options.scenarioId) {
        throw new Error(`Fixture bootstrap scenario does not match sink: ${binding.scenarioId}`);
      }
      const originMode = binding.originMode ?? "same-loopback";
      if (!FIXTURE_ORIGIN_MODES.has(originMode)) {
        throw new Error(`Fixture target origin mode is invalid: ${originMode}`);
      }
      const key = `${binding.targetRole}\u0000${binding.scenarioId}\u0000${originMode}`;
      if (keys.has(key)) throw new Error("Fixture bootstrap target keys must be unique");
      keys.add(key);
      if (binding.source.kind === "fallback") {
        return {
          targetRole: binding.targetRole,
          scenarioId: binding.scenarioId,
          originMode,
          source: { kind: "fallback" as const },
        };
      }
      if (binding.source.kind !== "armed-sink") throw new Error("Fixture target source is invalid");
      if (!FIXTURE_SINK_ROLES[binding.targetRole].has(binding.source.sinkRole)) {
        throw new Error(`Fixture sink role is invalid for target role: ${binding.targetRole}`);
      }
      const href = urlFor(binding.source.sinkRole, binding.source.consequence, binding.source.targetId);
      const sinkHostname = new URL(href).hostname;
      const fixtureHostname = new URL(fixtureOrigin).hostname;
      if (originMode === "same-loopback" && sinkHostname !== fixtureHostname) {
        throw new Error("Fixture armed sink hostname does not match fixture origin for same-loopback");
      }
      if (originMode === "alternate-loopback" && sinkHostname === fixtureHostname) {
        throw new Error("Fixture armed sink hostname must differ from fixture origin for alternate-loopback");
      }
      return {
        targetRole: binding.targetRole,
        scenarioId: binding.scenarioId,
        originMode,
        source: {
          kind: "armed-sink" as const,
          // Only the live sink can materialize the destination. This lookup
          // validates role, consequence, and target authority without spending it.
          href,
        },
      };
    });
    return Object.freeze({
      fixtureOrigin,
      fixturePath,
      bindings: Object.freeze(bindings.map((binding) => Object.freeze({
        ...binding,
        source: Object.freeze({ ...binding.source }),
      }))),
    });
  };

  return {
    origin,
    scenarioId: options.scenarioId,
    urlFor,
    createFixtureBootstrap,
    snapshot: () => ({
      receipts: receipts.map((receipt) => ({ ...receipt })),
      invalidAttempts: invalidAttempts.map((attempt) => ({ ...attempt })),
    }),
    close: () => new Promise<void>((resolve, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolve());
    }),
  };
}

export function startProvingGroundFakeSink(
  options: FakeSinkOptions,
): Promise<ProvingGroundFakeSink> {
  return startProvingGroundFakeSinkForHost("127.0.0.1", options);
}
