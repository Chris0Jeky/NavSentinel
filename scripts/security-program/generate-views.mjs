import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const programmeRoot = path.join(root, "docs", "security-program");
const registryRoot = path.join(programmeRoot, "registry");
const checkOnly = process.argv.includes("--check");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(programmeRoot, relativePath), "utf8"));
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(";") : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers, rows) {
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function mdCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ");
}

function table(headers, rows) {
  const header = `| ${headers.map(mdCell).join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  return [header, rule, ...rows.map((row) => `| ${row.map(mdCell).join(" | ")} |`)].join("\n");
}

function normalizeNewlines(value) {
  return value.replaceAll("\r\n", "\n");
}

const scenariosDocument = await readJson("registry/scenarios.json");
const capabilitiesDocument = await readJson("registry/capabilities.json");
const evidenceDocument = await readJson("registry/evidence-states.json");
const workDefinitionsDocument = await readJson("registry/work-unit-definitions.json");
const capabilityMapDocument = await readJson("registry/capability-map.json");
const existingEvidenceDocument = await readJson("registry/existing-evidence-map.json");
const issueMapDocument = await readJson("registry/issue-map.json");
const fixtureSafetyDocument = await readJson("registry/fixture-safety-findings.json");

const fixtureDispositionByPath = new Map(fixtureSafetyDocument.findings.map((finding) => [finding.path, finding.disposition]));
function mappingSafetyDisposition(mapping) {
  const dispositions = mapping.paths.map((sourcePath) => fixtureDispositionByPath.get(sourcePath)).filter(Boolean);
  if (dispositions.includes("QUARANTINED")) return "QUARANTINED";
  if (dispositions.includes("SAFETY_HOLD")) return "SAFETY_HOLD";
  return "CLEAR";
}

const tasks = scenariosDocument.scenarios.flatMap((scenario) =>
  workDefinitionsDocument.definitions.map((definition) => ({
    id: `${scenario.id}-${definition.suffix}`,
    scenario_id: scenario.id,
    suffix: definition.suffix,
    title: definition.title,
    exit: definition.exit,
    status: "LOCAL_ONLY",
    depends_on: definition.depends_on_suffixes.map((suffix) => `${scenario.id}-${suffix}`),
  })),
);

const backlog = {
  schema_version: "1.0.0",
  generated_from: ["registry/scenarios.json", "registry/work-unit-definitions.json"],
  task_count: tasks.length,
  tasks,
};

const familyCounts = new Map();
for (const scenario of scenariosDocument.scenarios) {
  familyCounts.set(scenario.family, (familyCounts.get(scenario.family) ?? 0) + 1);
}

const scenarioIndex = `# Scenario index

Generated from \`registry/scenarios.json\`. Do not edit this view by hand.

Registry: ${scenariosDocument.scenario_count} scenarios across ${familyCounts.size} families. Scenario evidence states remain conservative until the required receipts support promotion.

${table(
  ["ID", "Family", "Priority", "Severity", "Evidence", "Title"],
  scenariosDocument.scenarios.map((scenario) => [scenario.id, scenario.family, scenario.priority, scenario.severity, scenario.evidence_status, scenario.title]),
)}
`;

const scenarioCsv = csv(
  ["id", "family", "family_name", "title", "priority", "severity", "status", "evidence_status", "capability_dependencies", "existing_issue_refs"],
  scenariosDocument.scenarios.map((scenario) => [
    scenario.id,
    scenario.family,
    scenario.family_name,
    scenario.title,
    scenario.priority,
    scenario.severity,
    scenario.status,
    scenario.evidence_status,
    scenario.capability_dependencies,
    scenario.existing_issue_refs,
  ]),
);

const existingEvidenceCsv = csv(
  ["id", "kind", "label", "primary_scenario_id", "supporting_scenario_ids", "primary_harm_boundary", "role", "oracle_type", "current_oracle", "evidence_state", "evidence_validity", "fixture_safety", "known_limitation", "issue_refs", "pr_refs", "paths"],
  existingEvidenceDocument.mappings.map((mapping) => [
    mapping.id,
    mapping.kind,
    mapping.label,
    mapping.primary_scenario_id,
    mapping.supporting_scenario_ids,
    mapping.primary_harm_boundary,
    mapping.role,
    mapping.oracle_type,
    mapping.current_oracle,
    mapping.evidence_state,
    mapping.evidence_validity,
    mappingSafetyDisposition(mapping),
    mapping.known_limitation,
    mapping.issue_refs,
    mapping.pr_refs,
    mapping.paths,
  ]),
);

const capabilityById = new Map(capabilitiesDocument.capabilities.map((capability) => [capability.id, capability]));
const capabilityMatrix = `# Capability matrix

Generated from the canonical capability registry and the live reconciliation map. Do not edit this view by hand.

Profiles are boundaries, not a delivery promise. \`release_extension\`, \`research_extension\`, \`proving_ground\`, \`native_companion\`, and \`agent_future\` remain separate.

${table(
  ["ID", "Capability", "Track", "Priority", "Implementation", "Profiles", "Evidence", "Release posture", "Issues"],
  capabilityMapDocument.mappings.map((mapping) => {
    const capability = capabilityById.get(mapping.id);
    return [mapping.id, capability?.title ?? "UNKNOWN", capability?.track ?? "UNKNOWN", capability?.priority ?? "UNKNOWN", mapping.implementation_status, mapping.profiles.join(", "), mapping.evidence_state, mapping.release_status, mapping.issue_refs.join(", ") || "None"];
  }),
)}
`;

const scenarioEvidenceCounts = new Map(evidenceDocument.evidence_states.map((state) => [state.id, 0]));
for (const scenario of scenariosDocument.scenarios) {
  scenarioEvidenceCounts.set(scenario.evidence_status, (scenarioEvidenceCounts.get(scenario.evidence_status) ?? 0) + 1);
}
const mappedEvidenceCounts = new Map(evidenceDocument.evidence_states.map((state) => [state.id, 0]));
for (const mapping of existingEvidenceDocument.mappings) {
  mappedEvidenceCounts.set(mapping.evidence_state, (mappedEvidenceCounts.get(mapping.evidence_state) ?? 0) + 1);
}

const evidenceIndex = `# Evidence index

Generated from the evidence vocabulary, scenario registry, and existing-evidence reconciliation. Do not edit this view by hand.

An outcome describes what the independent harm oracle observed. An evidence state describes how well a scenario or capability has been substantiated. A product event, toast, hidden element, or rollback is not by itself proof of protection.

## Outcomes

${table(["Outcome", "Meaning"], evidenceDocument.outcomes.map((outcome) => [outcome.id, outcome.description]))}

## Evidence states

${table(
  ["Order", "State", "Meaning", "Canonical scenarios", "Existing mappings"],
  evidenceDocument.evidence_states.map((state) => [state.order, state.id, state.description, scenarioEvidenceCounts.get(state.id) ?? 0, mappedEvidenceCounts.get(state.id) ?? 0]),
)}

## Reconciled evidence validity

${table(
  ["Validity", "Count"],
  ["CURRENT_REGRESSION", "STALE", "INVALID", "UNVERIFIED"].map((validity) => [validity, existingEvidenceDocument.mappings.filter((mapping) => mapping.evidence_validity === validity).length]),
)}

## Fixture safety holds

${table(
  ["Disposition", "Mapped records", "Fixture paths"],
  ["CLEAR", "SAFETY_HOLD", "QUARANTINED"].map((disposition) => [
    disposition,
    existingEvidenceDocument.mappings.filter((mapping) => mappingSafetyDisposition(mapping) === disposition).length,
    disposition === "CLEAR" ? 0 : fixtureSafetyDocument.findings.filter((finding) => finding.disposition === disposition).length,
  ]),
)}

Safety-held and quarantined fixtures are excluded from programme evidence promotion until localized and reconciled.
`;

const evidenceMapping = `# Existing evidence mapping

Generated from \`registry/existing-evidence-map.json\`. This is a reconciliation view, not a claim that every mapped fixture is independent evidence of protection.

${table(
  ["Map ID", "Kind", "Primary scenario", "Role", "Oracle", "Evidence", "Validity", "Fixture safety", "Paths", "Known limitation"],
  existingEvidenceDocument.mappings.map((mapping) => [mapping.id, mapping.kind, mapping.primary_scenario_id, mapping.role, mapping.oracle_type, mapping.evidence_state, mapping.evidence_validity, mappingSafetyDisposition(mapping), mapping.paths.join("<br>"), mapping.known_limitation]),
)}
`;

const issueDeduplication = `# Issue deduplication

Generated from \`registry/issue-map.json\` after reconciling live issues, pull requests, docs, tests, and source on ${issueMapDocument.as_of}.

No per-scenario issue fan-out was created. The local registry retains all 1,512 scenario work units. Existing roadmap and milestone authority remains controlling.

${table(
  ["Theme", "Programme IDs", "Issues", "PRs", "Disposition", "Evidence boundary"],
  issueMapDocument.entries.map((entry) => [entry.theme, entry.programme_ids.join(", "), entry.issue_refs.join(", ") || "None", entry.pr_refs.join(", ") || "None", entry.disposition, entry.evidence_boundary]),
)}
`;

const outputs = new Map([
  ["registry/backlog-seed.json", `${JSON.stringify(backlog, null, 2)}\n`],
  ["generated/SCENARIO_INDEX.md", scenarioIndex],
  ["generated/scenarios.csv", scenarioCsv],
  ["generated/existing-evidence.csv", existingEvidenceCsv],
  ["CAPABILITY_MATRIX.md", capabilityMatrix],
  ["EVIDENCE_INDEX.md", evidenceIndex],
  ["reports/EXISTING_EVIDENCE_MAPPING.md", evidenceMapping],
  ["reports/ISSUE_DEDUPLICATION.md", issueDeduplication],
]);

const drift = [];
for (const [relativePath, content] of outputs) {
  const target = path.join(programmeRoot, relativePath);
  if (checkOnly) {
    let current = null;
    try {
      current = await readFile(target, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current === null || normalizeNewlines(current) !== normalizeNewlines(content)) drift.push(relativePath);
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

if (drift.length > 0) {
  console.error(`Generated security-program views are stale: ${drift.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(checkOnly ? `Verified ${outputs.size} deterministic generated views.` : `Generated ${outputs.size} security-program views.`);
}
