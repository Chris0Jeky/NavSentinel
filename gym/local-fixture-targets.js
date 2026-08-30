(() => {
  "use strict";

  const SENTINEL = "NAVSENTINEL_SENTINEL_DO_NOT_RUN";
  const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
  const FAKE_SINK_PATH = "/__navsentinel_fake_sink";
  const FAKE_SINK_PORT_MIN = 46100;
  const FAKE_SINK_PORT_MAX = 46124;
  const TARGETS = Object.freeze({
    benign: Object.freeze({
      parameter: "benign_target",
      consequence: "benign-navigation",
      sinkRoles: new Set(["benign", "mixed"]),
    }),
    harm: Object.freeze({
      parameter: "harm_target",
      consequence: "wrong-target-navigation",
      sinkRoles: new Set(["attack", "mixed"]),
    }),
  });

  function assertScenarioId(value) {
    if (!/^NS-ADV-[A-Z0-9-]+$/u.test(value)) {
      throw new Error("invalid-scenario-id");
    }
    return value;
  }

  function assertArmedLoopbackUrl(value, role, scenarioId) {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new Error("non-loopback-target");
    }
    const port = Number(parsed.port);
    const target = TARGETS[role];
    const targetId = parsed.searchParams.get("target_id") || "";
    const armed = parsed.hostname === "127.0.0.1" &&
      port >= FAKE_SINK_PORT_MIN && port <= FAKE_SINK_PORT_MAX &&
      parsed.pathname === FAKE_SINK_PATH &&
      parsed.username === "" && parsed.password === "" && parsed.hash === "" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        parsed.searchParams.get("run_id") || "",
      ) &&
      parsed.searchParams.get("scenario_id") === scenarioId &&
      target.sinkRoles.has(parsed.searchParams.get("role")) &&
      parsed.searchParams.get("consequence") === target.consequence &&
      /^[a-z0-9][a-z0-9-]{0,63}$/u.test(targetId) && targetId.endsWith(`-${role}`) &&
      parsed.searchParams.get("sentinel") === SENTINEL;
    if (!armed) throw new Error("unarmed-local-target");
    return parsed.href;
  }

  function fallbackUrl(role, scenarioId) {
    if (location.protocol !== "http:" || !LOOPBACK_HOSTS.has(location.hostname)) {
      throw new Error("non-loopback-fixture-origin");
    }
    const target = new URL("/local-fixture-sink.html", location.href);
    if (role === "harm" && (location.hostname === "127.0.0.1" || location.hostname === "localhost")) {
      target.hostname = location.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
    }
    target.searchParams.set("scenario_id", scenarioId);
    target.searchParams.set("role", role);
    target.searchParams.set("consequence", TARGETS[role].consequence);
    target.searchParams.set("sentinel", SENTINEL);
    return target.href;
  }

  function url(role, scenarioId) {
    if (!Object.hasOwn(TARGETS, role)) throw new Error("invalid-target-role");
    const checkedScenarioId = assertScenarioId(scenarioId);
    const override = new URLSearchParams(location.search).get(TARGETS[role].parameter);
    return override ? assertArmedLoopbackUrl(override, role, checkedScenarioId) : fallbackUrl(role, checkedScenarioId);
  }

  function apply(root = document) {
    const nodes = root.querySelectorAll("[data-navsentinel-local-target]");
    for (const node of nodes) {
      if (!(node instanceof HTMLAnchorElement)) throw new Error("target-is-not-anchor");
      const role = node.dataset.navsentinelLocalTarget;
      const scenarioId = node.dataset.navsentinelScenario;
      if (!role || !scenarioId) throw new Error("target-contract-incomplete");
      node.href = url(role, scenarioId);
      node.dataset.navsentinelLocalTargetReady = "1";
    }
    document.documentElement.dataset.navsentinelLocalTargetsReady = "1";
  }

  const api = Object.freeze({ apply, url });
  Object.defineProperty(window, "NavSentinelLocalTargets", {
    value: api,
    writable: false,
    configurable: false,
  });

  const applySafely = () => {
    try {
      apply();
    } catch (error) {
      document.documentElement.dataset.navsentinelLocalTargetsReady = "0";
      document.documentElement.dataset.navsentinelLocalTargetsError =
        error instanceof Error ? error.message : "unknown-target-error";
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applySafely, { once: true });
  } else {
    applySafely();
  }
})();
