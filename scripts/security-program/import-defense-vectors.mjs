import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const sourceDir = path.join(repoRoot, "RESOURCES", "DefenseVectors");
const registryDir = path.join(repoRoot, "docs", "security-program", "registry");

const OUTCOMES = [
  ["NO_SIGNAL", "The product observed nothing relevant."],
  ["OBSERVED", "Evidence was recorded without user-facing action."],
  ["ANNOTATED", "Passive information was shown."],
  ["WARNED", "A warning was shown, but the harmful sink remained reachable without a separate trusted decision."],
  ["HELD_PRE_HARM", "The consequence was paused before the declared harm boundary."],
  ["BLOCKED_PRE_HARM", "The consequence was prevented before the declared harm boundary."],
  ["ROLLED_BACK_POST_COMMIT", "A destination committed and was then reversed; exposure may have begun."],
  ["RECOVERED_AFTER_EXPOSURE", "The product helped after harmful exposure or state change began."],
  ["HARM_REACHED", "The local sink received or committed the protected consequence."],
  ["NOT_APPLICABLE", "The scenario does not exercise the selected capability or profile."],
  ["TEST_INVALID", "Harness, browser, readiness, network, or attribution failure invalidated the result."],
];

const EVIDENCE_STATES = [
  ["UNMODELLED", "Seed only."],
  ["MODELLED", "Invariant, boundary, malicious, benign, and mixed contracts were reviewed."],
  ["FIXTURE_PROVEN", "The safe malicious path reaches the local harm sink and controls reproduce."],
  ["REGRESSION_PROVEN", "The product handles the declared fixture and controls with an independent oracle."],
  ["ROBUSTNESS_PROVEN", "Declared adjacent mutations and benign duals pass within a recorded budget."],
  ["BROWSER_PROVEN", "Supported branded-browser lifecycle, accessibility, privacy, and performance qualification is complete."],
  ["EFFICACY_MEASURED", "Credible corpus or holdout and false-intervention evidence exists."],
  ["RELEASE_ELIGIBLE", "Profile, claims, permissions, package, privacy, and required gates align."],
];

const WORK_UNITS = [
  {
    suffix: "01-MODEL",
    title: "Model invariant and harm boundary",
    exit: "Reviewed card, duplicate map, and safety boundary",
    depends_on_suffixes: [],
  },
  {
    suffix: "02-ATTACK",
    title: "Build malicious safe fixture",
    exit: "Harm reaches the independent local sink without the product",
    depends_on_suffixes: ["01-MODEL"],
  },
  {
    suffix: "03-BENIGN",
    title: "Build benign control",
    exit: "Legitimate task completes with no unexplained intervention",
    depends_on_suffixes: ["01-MODEL"],
  },
  {
    suffix: "04-MIXED",
    title: "Build mixed journey",
    exit: "Legitimate work succeeds and the unauthorized consequence is isolated",
    depends_on_suffixes: ["02-ATTACK", "03-BENIGN"],
  },
  {
    suffix: "05-ORACLE",
    title: "Implement protected-vs-fired oracle",
    exit: "Outcome and timing are independent of the product event log",
    depends_on_suffixes: ["02-ATTACK", "03-BENIGN", "04-MIXED"],
  },
  {
    suffix: "06-DEFENCE",
    title: "Implement smallest defensive slice",
    exit: "Expected policy is enforced without broad regression",
    depends_on_suffixes: ["05-ORACLE"],
  },
  {
    suffix: "07-MUTATE",
    title: "Run invariant mutation campaign",
    exit: "Declared mutations and benign duals are recorded",
    depends_on_suffixes: ["06-DEFENCE"],
  },
  {
    suffix: "08-QUALIFY",
    title: "Qualify browser, state, privacy, and performance",
    exit: "Relevant qualification lanes are complete",
    depends_on_suffixes: ["07-MUTATE"],
  },
  {
    suffix: "09-CLOSE",
    title: "Close evidence and limitations",
    exit: "State is advanced truthfully with a receipt and durable handoff",
    depends_on_suffixes: ["08-QUALIFY"],
  },
];

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readUtf8(filePath));
}

function serializedJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function semanticSha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function bulletList(block, heading, nextHeading) {
  const start = block.indexOf(`**${heading}**`);
  const end = block.indexOf(`**${nextHeading}**`, start + 1);
  if (start < 0 || end < 0) throw new Error(`Capability block is missing ${heading}/${nextHeading}`);
  return block
    .slice(start, end)
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function inlineField(block, field) {
  const match = block.match(new RegExp(`\\*\\*${field}:\\*\\*\\s+(.+)`));
  if (!match) throw new Error(`Capability block is missing ${field}`);
  return match[1].trim();
}

function stripTicks(value) {
  return value.replaceAll("`", "");
}

function parseCapabilities(master) {
  const detailsStart = master.indexOf("### 4. Capability details");
  const detailsEnd = master.indexOf("### 5. Per-scenario work graph", detailsStart);
  if (detailsStart < 0 || detailsEnd < 0) {
    throw new Error("MASTER_DOCUMENT.md does not contain the expected capability detail section");
  }

  const details = master.slice(detailsStart, detailsEnd);
  const headingPattern = /^#### ([FCN]-\d{2})\s+[^\p{L}\p{N}]+\s+(.+)$/gmu;
  const headings = [...details.matchAll(headingPattern)];
  const capabilities = headings.map((heading, index) => {
    const blockStart = heading.index + heading[0].length;
    const blockEnd = index + 1 < headings.length ? headings[index + 1].index : details.length;
    const block = details.slice(blockStart, blockEnd);
    const dependencyText = inlineField(block, "Dependencies");

    return {
      id: heading[1],
      title: heading[2].trim(),
      track: stripTicks(inlineField(block, "Track")),
      priority: stripTicks(inlineField(block, "Priority")),
      phase: stripTicks(inlineField(block, "Phase")),
      issue_policy: stripTicks(inlineField(block, "Issue policy")),
      existing_issue_refs: inlineField(block, "Existing references").match(/#\d+/g) ?? [],
      purpose: inlineField(block, "Purpose"),
      scope: bulletList(block, "Scope", "Acceptance"),
      acceptance: bulletList(block, "Acceptance", "Dependencies:"),
      dependencies:
        dependencyText === "None" ? [] : [...dependencyText.matchAll(/`([FCN]-\d{2})`/g)].map((match) => match[1]),
    };
  });

  if (capabilities.length !== 31) {
    throw new Error(`Expected 31 capability definitions in MASTER_DOCUMENT.md, found ${capabilities.length}`);
  }
  return capabilities;
}

function sourceFiles() {
  return fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

const scenarioSourcePath = path.join(sourceDir, "scenarios.json");
const masterSourcePath = path.join(sourceDir, "MASTER_DOCUMENT.md");
const scenarios = readJson(scenarioSourcePath);
if (scenarios.scenario_count !== scenarios.scenarios?.length) {
  throw new Error("Supplied scenario_count does not match the scenarios array");
}

const capabilities = parseCapabilities(readUtf8(masterSourcePath));
const evidenceStates = {
  schema_version: "1.0.0",
  source: "RESOURCES/DefenseVectors/AGENT_SEED_BRIEF.md and MASTER_DOCUMENT.md section 01",
  outcome_count: OUTCOMES.length,
  evidence_state_count: EVIDENCE_STATES.length,
  outcomes: OUTCOMES.map(([id, description]) => ({ id, description })),
  evidence_states: EVIDENCE_STATES.map(([id, description], order) => ({
    id,
    order,
    description,
  })),
};

const capabilityRegistry = {
  schema_version: "1.0.0",
  source: "RESOURCES/DefenseVectors/MASTER_DOCUMENT.md section 08",
  capability_count: capabilities.length,
  capabilities,
};

const workUnitDefinitions = {
  schema_version: "1.0.0",
  source: "RESOURCES/DefenseVectors/MASTER_DOCUMENT.md section 08.5",
  definition_count: WORK_UNITS.length,
  definitions: WORK_UNITS,
};

const importedDocuments = new Map([
  ["scenarios.json", scenarios],
  ["capabilities.json", capabilityRegistry],
  ["evidence-states.json", evidenceStates],
  ["work-unit-definitions.json", workUnitDefinitions],
]);
const files = sourceFiles();
const sourceProvenance = {
  schema_version: "1.0.0",
  source_generated: scenarios.generated,
  source_bundle_file_count: files.length,
  files: files.map((name) => ({
    path: `RESOURCES/DefenseVectors/${name}`,
    sha256: sha256(path.join(sourceDir, name)),
  })),
  imported_outputs: [...importedDocuments].map(([name, value]) => ({
    path: `docs/security-program/registry/${name}`,
    semantic_sha256: semanticSha256(value),
  })),
  independently_imported: [
    "RESOURCES/DefenseVectors/scenarios.json",
    "RESOURCES/DefenseVectors/MASTER_DOCUMENT.md capability details",
    "RESOURCES/DefenseVectors/MASTER_DOCUMENT.md work-unit graph",
    "RESOURCES/DefenseVectors/AGENT_SEED_BRIEF.md outcome and evidence vocabularies",
  ],
  advertised_but_missing_from_supplied_bundle: [
    "catalog/capabilities.json",
    "catalog/evidence_states.json",
    "catalog/backlog_seed.json",
    "schemas/scenario.schema.json",
    "schemas/capability.schema.json",
    "the remaining files behind the advertised 268-file source set",
  ],
  note: "The imported capability, evidence-state, and work-unit registries are deterministic reconstructions from the supplied master document. The upstream validation report could not be rerun against absent upstream files.",
};

const outputs = new Map([
  ...importedDocuments,
  ["SOURCE_PROVENANCE.json", sourceProvenance],
]);
const writeRequested = process.argv.includes("--write");
const forceRequested = process.argv.includes("--force");
if (forceRequested && !writeRequested) {
  throw new Error("--force is valid only with --write");
}

const drift = [];
for (const [name, value] of outputs) {
  const target = path.join(registryDir, name);
  const expected = serializedJson(value);
  const exists = fs.existsSync(target);
  const current = exists ? fs.readFileSync(target, "utf8") : null;
  let matches = false;
  if (current !== null) {
    try {
      matches = JSON.stringify(JSON.parse(current)) === JSON.stringify(value);
    } catch {
      matches = false;
    }
  }

  if (!writeRequested) {
    if (!matches) drift.push(name);
    continue;
  }

  if (exists && !matches && !forceRequested) {
    throw new Error(`${name} differs from the supplied bundle; rerun with --write --force only after reviewing the canonical replacement`);
  }
  if (!exists || !matches) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, expected, "utf8");
  }
}

if (!writeRequested && drift.length > 0) {
  throw new Error(`Imported canonical snapshots differ or are missing: ${drift.join(", ")}. Use --write for missing files or --write --force only after reviewing replacements.`);
}

console.log(
  `${writeRequested ? "Wrote" : "Verified"} ${scenarios.scenarios.length} scenarios, ${capabilities.length} capabilities, ${OUTCOMES.length} outcomes, and ${WORK_UNITS.length} work-unit definitions against the supplied bundle.`,
);
