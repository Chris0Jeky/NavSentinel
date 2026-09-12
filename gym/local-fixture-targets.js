(() => {
  "use strict";

  const SENTINEL = "NAVSENTINEL_SENTINEL_DO_NOT_RUN";
  const LOOPBACK_HOSTS = new Set(["127.0.0.1", "127.0.0.2", "localhost", "[::1]"]);
  const ARMED_LOOPBACK_HOSTS = new Set(["127.0.0.1", "127.0.0.2", "[::1]"]);
  const FAKE_SINK_PATH = "/__navsentinel_fake_sink";
  const FAKE_SINK_PORT_MIN = 46100;
  const FAKE_SINK_PORT_MAX = 46124;
  const TARGETS = Object.freeze({
    benign: Object.freeze({
      consequence: "benign-navigation",
      sinkRoles: new Set(["benign", "mixed"]),
    }),
    harm: Object.freeze({
      consequence: "wrong-target-navigation",
      sinkRoles: new Set(["attack", "mixed"]),
    }),
  });
  const SCENARIO_HARM_CONSEQUENCES = Object.freeze({
    "NS-ADV-WIN-001": "unauthorized-browsing-context",
  });
  const ORIGIN_MODES = new Set(["same-loopback", "alternate-loopback"]);

  function consequenceFor(role, scenarioId) {
    return role === "harm"
      ? (SCENARIO_HARM_CONSEQUENCES[scenarioId] || TARGETS.harm.consequence)
      : TARGETS[role].consequence;
  }

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
    const armed = ARMED_LOOPBACK_HOSTS.has(parsed.hostname) &&
      port >= FAKE_SINK_PORT_MIN && port <= FAKE_SINK_PORT_MAX &&
      parsed.pathname === FAKE_SINK_PATH &&
      parsed.username === "" && parsed.password === "" && parsed.hash === "" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        parsed.searchParams.get("run_id") || "",
      ) &&
      parsed.searchParams.get("scenario_id") === scenarioId &&
      target.sinkRoles.has(parsed.searchParams.get("role")) &&
      parsed.searchParams.get("consequence") === consequenceFor(role, scenarioId) &&
      /^[a-z0-9][a-z0-9-]{0,63}$/u.test(targetId) && targetId.endsWith(`-${role}`) &&
      parsed.searchParams.get("sentinel") === SENTINEL;
    if (!armed) throw new Error("unarmed-local-target");
    return parsed.href;
  }

  function alternateLoopbackHost(hostname) {
    if (hostname === "127.0.0.1") return "localhost";
    if (hostname === "localhost") return "127.0.0.1";
    throw new Error("unsupported-loopback-origin-family");
  }

  function fallbackUrl(role, scenarioId, originMode) {
    if (location.protocol !== "http:" || !LOOPBACK_HOSTS.has(location.hostname)) {
      throw new Error("non-loopback-fixture-origin");
    }
    const target = new URL("/local-fixture-sink.html", location.href);
    // Keep the default fallback on the fixture server so a Gym bound to one
    // loopback address family stays reachable. Evidence lanes supply an armed
    // sink override; hostname separation is only for fixtures that request it.
    if (originMode === "alternate-loopback") {
      target.hostname = alternateLoopbackHost(location.hostname);
    }
    target.searchParams.set("scenario_id", scenarioId);
    target.searchParams.set("role", role);
    target.searchParams.set("consequence", consequenceFor(role, scenarioId));
    target.searchParams.set("sentinel", SENTINEL);
    return target.href;
  }

  function resolveBootstrap(role, scenarioId, originMode) {
    const resolver = window.NavSentinelFixtureTargetBootstrap;
    if (!resolver || typeof resolver.resolve !== "function") return null;
    const result = resolver.resolve(role, scenarioId, originMode);
    if (!result || result.status === "document-mismatch") {
      throw new Error("bootstrap-document-mismatch");
    }
    if (result.status !== "resolved") throw new Error("bootstrap-target-unbound");
    if (result.kind === "fallback") return fallbackUrl(role, scenarioId, originMode);
    if (result.kind !== "armed-sink" || typeof result.href !== "string") {
      throw new Error("bootstrap-target-unbound");
    }
    // The bootstrap may only return URLs materialized by the live fake sink;
    // re-check the complete structural contract at the final fixture boundary.
    return assertArmedLoopbackUrl(result.href, role, scenarioId);
  }

  function url(role, scenarioId, originMode = "same-loopback") {
    if (!Object.hasOwn(TARGETS, role)) throw new Error("invalid-target-role");
    if (!ORIGIN_MODES.has(originMode)) throw new Error("invalid-origin-mode");
    const checkedScenarioId = assertScenarioId(scenarioId);
    const legacyParameters = new URLSearchParams(location.search);
    if (legacyParameters.has("harm_target") || legacyParameters.has("benign_target")) {
      throw new Error("legacy-target-override-rejected");
    }
    return resolveBootstrap(role, checkedScenarioId, originMode) ??
      fallbackUrl(role, checkedScenarioId, originMode);
  }

  function apply(root = document) {
    const nodes = root.querySelectorAll("[data-navsentinel-local-target]");
    // Static fixture anchors start without a destination. Disarm every matching
    // anchor before validating or resolving any target so a malformed target (or
    // hostile-origin override) cannot leave an earlier anchor navigable.
    for (const node of nodes) {
      if (node instanceof HTMLAnchorElement) {
        node.removeAttribute("href");
        delete node.dataset.navsentinelLocalTargetReady;
      }
    }

    const invalidMarker = document.documentElement.getAttribute("data-navsentinel-fixture-invalid");
    if (invalidMarker !== null) throw new Error(`fixture-invalid:${invalidMarker}`);

    const destinations = [];
    for (const node of nodes) {
      if (!(node instanceof HTMLAnchorElement)) throw new Error("target-is-not-anchor");
      const role = node.dataset.navsentinelLocalTarget;
      const scenarioId = node.dataset.navsentinelScenario;
      const originMode = node.dataset.navsentinelLocalTargetOrigin || "same-loopback";
      if (!role || !scenarioId) throw new Error("target-contract-incomplete");
      destinations.push({ node, href: url(role, scenarioId, originMode) });
    }
    for (const { node, href } of destinations) {
      node.href = href;
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
