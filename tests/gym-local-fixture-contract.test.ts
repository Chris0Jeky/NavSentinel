import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { looksLikeCommand, matchesCaptchaPattern, matchesInstructionPattern } from "../extension/src/content/clickfix_detector";
import { MAX_PENDING_OUTBOUND } from "../extension/src/content/main_guard_constants";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gymRoot = path.join(repositoryRoot, "gym");

const fixtures = [
  { file: "level1-basic-opacity.html", scenarioId: "NS-ADV-UI-001", kind: "static-harm" },
  { file: "level2-moving-target.html", scenarioId: "NS-ADV-UI-002", kind: "static-harm" },
  { file: "level3-instant-injection.html", scenarioId: "NS-ADV-UI-003", kind: "dynamic-harm" },
  { file: "level4-visual-mimicry.html", scenarioId: "NS-ADV-UI-006", kind: "static-harm" },
  { file: "level5-window-open-popunder.html", scenarioId: "NS-ADV-WIN-001", kind: "dynamic-harm" },
  { file: "level6-programmatic-click.html", scenarioId: "NS-ADV-SELF-003", kind: "static-harm" },
  { file: "level9-legit-video-overlay.html", scenarioId: "NS-ADV-UI-004", kind: "static-benign" },
] as const;

const rwFixtures = [
  { file: "rw01-search-result-overlay-swap.html", scenarioId: "NS-ADV-SUPPLY-001", kind: "static-dual" },
  { file: "rw06-legit-auth-second-popup.html", scenarioId: "NS-ADV-AUTH-005", kind: "dynamic-dual" },
] as const;

const stateAuthorityFixtures = [
  { file: "rw21-allow-once-double-spend.html", scenarioId: "NS-ADV-WIN-005" },
  { file: "rw24-idle-resume-popup.html", scenarioId: "NS-ADV-EVADE-003" },
  { file: "rw25-rapid-close-reopen.html", scenarioId: "NS-ADV-STATE-008" },
] as const;

const clipboardFixture = {
  file: "clickfix-05-delayed-rewrite.html",
  scenarioId: "NS-ADV-CLIP-005",
} as const;

describe("core Gym fixture locality contracts", () => {
  it.each(fixtures)("keeps $file on the typed local-target contract", ({ file, scenarioId, kind }) => {
    const source = fs.readFileSync(path.join(gymRoot, file), "utf8");

    expect(source).toContain('<script src="local-fixture-targets.js"></script>');
    expect(source).not.toMatch(/https?:\/\//u);

    if (kind === "dynamic-harm") {
      expect(source).toContain(`window.NavSentinelLocalTargets.url('harm', '${scenarioId}')`);
      return;
    }

    expect(source).not.toMatch(/<a\b[^>]*\bhref\s*=/iu);
    expect(source).toContain(`data-navsentinel-scenario="${scenarioId}"`);
    if (file === "level9-legit-video-overlay.html") {
      expect(source).toContain('data-navsentinel-local-target-origin="alternate-loopback"');
    }
    expect(source).toContain(`data-navsentinel-local-target="${kind === "static-benign" ? "benign" : "harm"}"`);
  });

  it("keeps every static helper consumer inert until target validation succeeds", () => {
    const consumers = fs.readdirSync(gymRoot)
      .filter((file) => file.endsWith(".html"))
      .filter((file) => /data-navsentinel-local-target=/u.test(fs.readFileSync(path.join(gymRoot, file), "utf8")));

    // New defensive fixtures may join this shared contract without forcing an
    // unrelated exact-count update. The explicit fixture tables and focused
    // specs protect known consumers; this floor catches accidental broad removal.
    expect(consumers.length).toBeGreaterThanOrEqual(18);
    for (const file of consumers) {
      const source = fs.readFileSync(path.join(gymRoot, file), "utf8");
      const targetAnchors = [...source.matchAll(/<a\b[^>]*data-navsentinel-local-target=[^>]*>/giu)];
      expect(targetAnchors, `${file} must contain typed target anchors`).not.toHaveLength(0);
      for (const anchor of targetAnchors) {
        expect(anchor[0], `${file} target anchor must not expose an initial href`).not.toMatch(/\bhref\s*=/iu);
      }
    }
  });
});

describe("Evasion Gym fixture locality contracts", () => {
  it("pins alternate-loopback usage to the two cross-loopback fixtures", () => {
    const evasion04 = fs.readFileSync(path.join(gymRoot, "evasion-04-zindex-9998.html"), "utf8");
    const evasion11 = fs.readFileSync(path.join(gymRoot, "evasion-11-shadow-dom.html"), "utf8");

    expect(evasion04).toContain('data-navsentinel-local-target="harm"');
    expect(evasion04).toContain('data-navsentinel-local-target-origin="alternate-loopback"');
    expect(evasion11).toContain(
      'window.NavSentinelLocalTargets.url("harm", "NS-ADV-RUNTIME-001", "alternate-loopback")',
    );
  });
});

describe("RW Gym fixture locality contracts", () => {
  it.each(rwFixtures)("keeps $file on typed local benign and harm destinations", ({ file, scenarioId, kind }) => {
    const source = fs.readFileSync(path.join(gymRoot, file), "utf8");

    expect(source).toContain('<script src="local-fixture-targets.js"></script>');
    expect(source).not.toMatch(/https?:\/\//u);
    if (kind === "static-dual") {
      const benignAnchor = source.match(/<a\b[^>]*data-navsentinel-local-target=["']benign["'][^>]*>/iu)?.[0] ?? "";
      const harmAnchor = source.match(/<a\b[^>]*data-navsentinel-local-target=["']harm["'][^>]*>/iu)?.[0] ?? "";

      expect(benignAnchor, `${file} must contain a typed benign anchor`).not.toBe("");
      expect(harmAnchor, `${file} must contain a typed harm anchor`).not.toBe("");
      expect(benignAnchor, `${file} benign anchor must carry scenario id`).toContain(`data-navsentinel-scenario="${scenarioId}"`);
      expect(harmAnchor, `${file} harm anchor must carry scenario id`).toContain(`data-navsentinel-scenario="${scenarioId}"`);
      expect(harmAnchor, `${file} harm anchor must request origin separation`)
        .toContain('data-navsentinel-local-target-origin="alternate-loopback"');
      expect(benignAnchor, `${file} benign anchor must not expose an initial href`).not.toMatch(/\bhref\s*=/iu);
      expect(harmAnchor, `${file} harm anchor must not expose an initial href`).not.toMatch(/\bhref\s*=/iu);
      return;
    }
    expect(source).toContain(`NavSentinelLocalTargets.url('benign', '${scenarioId}')`);
    expect(source).toContain(
      `NavSentinelLocalTargets.url('harm', '${scenarioId}', 'alternate-loopback')`,
    );
  });

  it.each(stateAuthorityFixtures)(
    "keeps $file on one typed benign and one typed harm authority",
    ({ file, scenarioId }) => {
      const source = fs.readFileSync(path.join(gymRoot, file), "utf8");
      const benignAnchor = source.match(/<a\b[^>]*data-navsentinel-local-target=["']benign["'][^>]*>/iu)?.[0] ?? "";
      const harmAnchor = source.match(/<a\b[^>]*data-navsentinel-local-target=["']harm["'][^>]*>/iu)?.[0] ?? "";

      expect(source).toContain('<script src="local-fixture-targets.js"></script>');
      expect(source).not.toMatch(/https?:\/\//u);
      expect(benignAnchor, `${file} must contain a typed benign anchor`).not.toBe("");
      expect(harmAnchor, `${file} must contain a typed harm anchor`).not.toBe("");
      expect(benignAnchor).toContain(`data-navsentinel-scenario="${scenarioId}"`);
      expect(harmAnchor).toContain(`data-navsentinel-scenario="${scenarioId}"`);
      expect(benignAnchor, `${file} benign authority must start inert`).not.toMatch(/\bhref\s*=/iu);
      expect(harmAnchor, `${file} harm authority must start inert`).not.toMatch(/\bhref\s*=/iu);
    },
  );
});

describe("clipboard time-bomb Gym fixture contract", () => {
  it("keeps malicious and benign consequences on typed inert local targets", () => {
    const source = fs.readFileSync(path.join(gymRoot, clipboardFixture.file), "utf8");
    const harmAnchor = source.match(/<a\b[^>]*data-navsentinel-local-target=["']harm["'][^>]*>/iu)?.[0] ?? "";
    const benignAnchor = source.match(/<a\b[^>]*data-navsentinel-local-target=["']benign["'][^>]*>/iu)?.[0] ?? "";

    expect(source).toContain('<script src="local-fixture-targets.js"></script>');
    expect(source).not.toMatch(/https?:\/\//u);
    expect(source).toContain("NAVSENTINEL_SENTINEL_DO_NOT_RUN");
    expect(source).toContain("CASE-48-DELTA | formatted locally");
    expect(source).toContain('let rewriteArmed = MODE !== "invalid"');
    expect(source).toMatch(/navigator\.clipboard\.writeText\(benignRewrite \? BENIGN_REWRITE : INERT_REWRITE\)/u);
    expect(source).toContain('if (MODE === "benign") overlay.remove()');
    expect(source).not.toMatch(/\b(?:powershell|pwsh)(?:\.exe)?\s+(?:-|\/)\w/iu);
    expect(source).not.toMatch(/\bcmd(?:\.exe)?\s+\/[ck]\b/iu);
    expect(harmAnchor).toContain(`data-navsentinel-scenario="${clipboardFixture.scenarioId}"`);
    expect(benignAnchor).toContain(`data-navsentinel-scenario="${clipboardFixture.scenarioId}"`);
    expect(harmAnchor).not.toMatch(/\bhref\s*=/iu);
    expect(benignAnchor).not.toMatch(/\bhref\s*=/iu);
  });

  it("caps unbound CLIP-005 observations at the machine-checked MODELLED ceiling", () => {
    const registry = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, "docs", "security-program", "registry", "existing-evidence-map.json"),
      "utf8",
    )) as {
      mappings: Array<{ id: string; evidence_state: string; evidence_validity: string }>;
    };
    const mapping = registry.mappings.find(({ id }) => id === "MAP-CLICKFIX-05");
    const spec = fs.readFileSync(path.join(repositoryRoot, "tests", "e2e", "clipboard-timebomb.spec.ts"), "utf8");

    expect(mapping).toMatchObject({ evidence_state: "MODELLED", evidence_validity: "UNVERIFIED" });
    expect(spec).toContain('evidenceValidity: "UNVERIFIED"');
    expect(spec).toContain('promotionCeiling: "MODELLED"');
    expect(spec).toContain("provenanceBound: false");
  });
});

describe("clipboard-pressure Gym fixture contract (#947)", () => {
  const file = "clickfix-06-clipboard-pressure.html";
  const source = fs.readFileSync(path.join(gymRoot, file), "utf8");
  const headEnd = source.indexOf("</head>");
  const bodyStart = source.indexOf("<body>", headEnd);

  it("stays local and writes only inert values", () => {
    expect(source).not.toMatch(/https?:\/\//u);
    expect(source).not.toMatch(/\b(?:powershell|pwsh)(?:\.exe)?\s+(?:-|\/)\w/iu);
    expect(source).not.toMatch(/\bcmd(?:\.exe)?\s+\/[ck]\b/iu);
    expect(source).toContain('const INERT_COMMAND_LIKE = "NAVSENTINEL_SENTINEL_DO_NOT_RUN base64";');
    expect(source).toContain('const FLOOD_PREFIX = "CF06-FLOOD-";');
    // The attack value must be command-like to the product's own classifier and
    // the flood values must not be, or the arms stop isolating the queue policy.
    expect(looksLikeCommand("NAVSENTINEL_SENTINEL_DO_NOT_RUN base64")).toBe(true);
    expect(looksLikeCommand("CF06-FLOOD-1000")).toBe(false);
    expect(looksLikeCommand("CF06-FLOOD-1039")).toBe(false);
  });

  it("floods more receipts than the pre-handshake queue holds", () => {
    const floodWrites = Number(source.match(/const FLOOD_WRITES = (\d+);/u)?.[1]);
    // Without #599's coalescing, one more receipt than the cap is what drops the
    // command-like receipt and surfaces a bridge_buffer_overflow row.
    expect(floodWrites).toBeGreaterThan(MAX_PENDING_OUTBOUND);
  });

  it("uses the exact MAIN bridge-ready post as the queue boundary (#954)", () => {
    // The public DOM marker is delivered one MessagePort hop after MAIN flips
    // bridgeVerified. The fixture must observe the outgoing ready message in
    // the page realm and compare execution sequence numbers, not timestamps or
    // the delayed DOM marker.
    expect(source).toContain("const nativePortPostMessage = MessagePort.prototype.postMessage;");
    expect(source).toContain('message.type === "ns-bridge-ready"');
    expect(source).toContain("check.verifiedSequence = nextSequence();");
    expect(source).toContain("write.resolvedSequence = nextSequence();");
    expect(source).toContain("write.resolvedSequence < check.verifiedSequence");
    expect(source).toContain("root.dataset.pressureBeforeVerified");
    expect(source).not.toContain("s.beforeReady < s.attempted");
  });

  it("keeps retry attribution on a unique persisted path (#954)", () => {
    const acceptanceSource = fs.readFileSync(
      path.join(repositoryRoot, "tests", "acceptance", "ai47-8-clipboard-pressure.spec.ts"),
      "utf8",
    );
    const harnessSource = fs.readFileSync(
      path.join(repositoryRoot, "tests", "acceptance", "acceptance_harness.ts"),
      "utf8",
    );

    expect(harnessSource).toContain('const PRESSURE_FIXTURE_ALIAS_PREFIX = "/acceptance/clickfix-06/";');
    expect(harnessSource).toContain('[gymRoot, "/clickfix-06-clipboard-pressure.html"]');
    expect(acceptanceSource).toContain("function pressureRunPath(");
    expect(acceptanceSource).toContain("eventRowsForUrl(");
    expect(acceptanceSource).toContain("eventUrl = redactUrl(url);");
    expect(acceptanceSource).not.toContain("logBefore");
  });

  it("gives the detector no page-text signal, so a benign write alone cannot warn", () => {
    expect(headEnd).toBeGreaterThan(0);
    expect(bodyStart).toBeGreaterThan(headEnd);
    const body = source.slice(bodyStart);
    // body.textContent is what the detector scans; keep scripts and styles out of it.
    expect(body).not.toMatch(/<script|<style/iu);
    const bodyText = body.replace(/<[^>]+>/gu, " ");
    expect(matchesCaptchaPattern(bodyText)).toBe(false);
    expect(matchesInstructionPattern(bodyText)).toBe(false);
    // The self-check labels and reasons live in the head script and are rendered
    // into the overlay at runtime, so they must stay pattern-free as well.
    const head = source.slice(0, headEnd);
    expect(matchesCaptchaPattern(head)).toBe(false);
    expect(matchesInstructionPattern(head)).toBe(false);
  });
});
