import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const programmeRoot = path.join(root, "docs", "security-program");
const registryRoot = path.join(programmeRoot, "registry");
const schemaRoot = path.join(registryRoot, "schema");
const errors = [];
const requireSourceBundle = process.argv.includes("--require-source");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(programmeRoot, relativePath), "utf8"));
}

function fail(message) {
  errors.push(message);
}

function requireCount(label, declared, values) {
  if (declared !== values.length) fail(`${label} count drift: declared ${declared}, found ${values.length}`);
}

function requireUnique(label, values) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(`${label} duplicate: ${value}`);
    seen.add(value);
  }
}

function requireResolved(label, values, known) {
  for (const value of values) {
    if (!known.has(value)) fail(`${label} unresolved dependency: ${value}`);
  }
}

async function pathExists(relativePath) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function unsafeFixtureFindings(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const findings = [];
  const urlPattern = /https?:\/\/[^\s"'<>`)]+/giu;
  for (const match of text.matchAll(urlPattern)) {
    try {
      const hostname = new URL(match[0]).hostname.toLowerCase();
      if (!(hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".test") || hostname.endsWith(".invalid"))) {
        findings.push(`non-reserved URL ${match[0]}`);
      }
    } catch {
      findings.push(`unparseable URL ${match[0]}`);
    }
  }
  const executablePatterns = [
    /\b(?:powershell|pwsh)(?:\.exe)?\s+(?:-|\/)[a-z]/iu,
    /\bcmd(?:\.exe)?\s+\/[ck]\b/iu,
    /\b(?:bash|sh)\s+-c\b/iu,
    /\b(?:curl|wget)\s+(?:-[a-z]+\s+)*https?:\/\//iu,
    /\binvoke-webrequest\b/iu,
    /\b(?:child_process|shell\.exec|execsync|spawnsync)\b/iu,
    /\brm\s+-rf\b/iu,
  ];
  for (const pattern of executablePatterns) {
    const match = text.match(pattern);
    if (match) findings.push(`executable command pattern ${JSON.stringify(match[0])}`);
  }
  const credentialPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /\bAKIA[0-9A-Z]{16}\b/u,
    /\bBearer\s+[A-Za-z0-9._~-]{20,}\b/u,
  ];
  for (const pattern of credentialPatterns) {
    if (pattern.test(text)) findings.push(`credential-shaped content matching ${pattern}`);
  }
  return findings;
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files;
}

async function allFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await allFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function validateLocalMarkdownLinks() {
  for (const markdownPath of await markdownFiles(programmeRoot)) {
    const text = await readFile(markdownPath, "utf8");
    const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of text.matchAll(linkPattern)) {
      let target = match[1].trim();
      if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
      target = target.split("#", 1)[0];
      if (!target) continue;
      const resolved = path.resolve(path.dirname(markdownPath), target);
      try {
        await stat(resolved);
      } catch (error) {
        if (error.code === "ENOENT") fail(`broken Markdown link in ${path.relative(root, markdownPath)}: ${match[1]}`);
        else throw error;
      }
    }
  }
}

const schemas = {
  "registry/scenarios.json": "scenario.schema.json",
  "registry/capabilities.json": "capability.schema.json",
  "registry/evidence-states.json": "evidence-states.schema.json",
  "registry/work-unit-definitions.json": "work-unit-definitions.schema.json",
  "registry/capability-map.json": "capability-map.schema.json",
  "registry/existing-evidence-map.json": "existing-evidence-map.schema.json",
  "registry/issue-map.json": "issue-map.schema.json",
  "registry/backlog-seed.json": "backlog-seed.schema.json",
  "registry/SOURCE_PROVENANCE.json": "source-provenance.schema.json",
  "registry/fixture-safety-findings.json": "fixture-safety-findings.schema.json",
};

const documents = new Map();
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const [documentPath, schemaName] of Object.entries(schemas)) {
  const [document, schema] = await Promise.all([
    readJson(documentPath),
    JSON.parse(await readFile(path.join(schemaRoot, schemaName), "utf8")),
  ]);
  documents.set(documentPath, document);
  const validate = ajv.compile(schema);
  if (!validate(document)) {
    for (const error of validate.errors ?? []) fail(`${documentPath}${error.instancePath || "/"}: ${error.message}`);
  }
}

const scenariosDocument = documents.get("registry/scenarios.json");
const capabilitiesDocument = documents.get("registry/capabilities.json");
const evidenceDocument = documents.get("registry/evidence-states.json");
const workDefinitionsDocument = documents.get("registry/work-unit-definitions.json");
const capabilityMapDocument = documents.get("registry/capability-map.json");
const existingEvidenceDocument = documents.get("registry/existing-evidence-map.json");
const issueMapDocument = documents.get("registry/issue-map.json");
const backlogDocument = documents.get("registry/backlog-seed.json");
const fixtureSafetyDocument = documents.get("registry/fixture-safety-findings.json");

requireCount("scenario", scenariosDocument.scenario_count, scenariosDocument.scenarios);
requireCount("capability", capabilitiesDocument.capability_count, capabilitiesDocument.capabilities);
requireCount("outcome", evidenceDocument.outcome_count, evidenceDocument.outcomes);
requireCount("evidence state", evidenceDocument.evidence_state_count, evidenceDocument.evidence_states);
requireCount("work-unit definition", workDefinitionsDocument.definition_count, workDefinitionsDocument.definitions);
requireCount("capability mapping", capabilityMapDocument.mapping_count, capabilityMapDocument.mappings);
requireCount("existing evidence mapping", existingEvidenceDocument.mapping_count, existingEvidenceDocument.mappings);
requireCount("backlog task", backlogDocument.task_count, backlogDocument.tasks);
requireCount("fixture safety finding", fixtureSafetyDocument.finding_count, fixtureSafetyDocument.findings);

const rawScenarioIds = scenariosDocument.scenarios.map((scenario) => scenario.id);
const rawCapabilityIds = capabilitiesDocument.capabilities.map((capability) => capability.id);
const rawWorkSuffixes = workDefinitionsDocument.definitions.map((definition) => definition.suffix);
const rawTaskIds = backlogDocument.tasks.map((task) => task.id);
const scenarioIds = new Set(rawScenarioIds);
const capabilityIds = new Set(rawCapabilityIds);
const familyIds = new Set(scenariosDocument.scenarios.map((scenario) => scenario.family));
const outcomeIds = evidenceDocument.outcomes.map((outcome) => outcome.id);
const evidenceStateIds = evidenceDocument.evidence_states.map((state) => state.id);
const workSuffixes = new Set(rawWorkSuffixes);
const taskIds = new Set(rawTaskIds);

requireUnique("scenario ID", rawScenarioIds);
requireUnique("scenario slug", scenariosDocument.scenarios.map((scenario) => scenario.slug));
requireUnique("capability ID", rawCapabilityIds);
requireUnique("outcome ID", outcomeIds);
requireUnique("evidence-state ID", evidenceStateIds);
requireUnique("evidence-state order", evidenceDocument.evidence_states.map((state) => state.order));
requireUnique("work-unit suffix", rawWorkSuffixes);
requireUnique("capability-map ID", capabilityMapDocument.mappings.map((mapping) => mapping.id));
requireUnique("existing-evidence-map ID", existingEvidenceDocument.mappings.map((mapping) => mapping.id));
requireUnique("backlog task ID", rawTaskIds);
requireUnique("fixture safety path", fixtureSafetyDocument.findings.map((finding) => finding.path));

for (const scenario of scenariosDocument.scenarios) {
  requireResolved(`${scenario.id} capability`, scenario.capability_dependencies, capabilityIds);
  if (scenario.status !== scenario.evidence_status) fail(`${scenario.id} status and evidence_status disagree`);
  const safetyText = scenario.safety_constraints.join(" ");
  for (const required of ["local or reserved test origins", "synthetic sentinel", "No real credential collection", "local, inert, inspectable", "benign and mixed controls are mandatory"]) {
    if (!safetyText.includes(required)) fail(`${scenario.id} is missing required fixture safety constraint: ${required}`);
  }
  const fixtureFields = {
    malicious_fixture: scenario.malicious_fixture,
    benign_control: scenario.benign_control,
    mixed_fixture: scenario.mixed_fixture,
  };
  for (const [field, value] of Object.entries(fixtureFields)) {
    for (const finding of unsafeFixtureFindings(value)) fail(`${scenario.id}.${field}: ${finding}`);
  }
}

for (const capability of capabilitiesDocument.capabilities) {
  requireResolved(`${capability.id} capability`, capability.dependencies, capabilityIds);
}
for (const definition of workDefinitionsDocument.definitions) {
  requireResolved(`${definition.suffix} work-unit`, definition.depends_on_suffixes, workSuffixes);
}
for (const task of backlogDocument.tasks) {
  if (!scenarioIds.has(task.scenario_id)) fail(`${task.id} unresolved scenario: ${task.scenario_id}`);
  requireResolved(`${task.id} task`, task.depends_on, taskIds);
}
if (backlogDocument.tasks.length !== scenariosDocument.scenarios.length * workDefinitionsDocument.definitions.length) {
  fail(`backlog cardinality drift: expected ${scenariosDocument.scenarios.length * workDefinitionsDocument.definitions.length}, found ${backlogDocument.tasks.length}`);
}

if (capabilityMapDocument.mappings.length !== capabilityIds.size) fail("capability map must contain exactly one entry for every capability");
for (const mapping of capabilityMapDocument.mappings) {
  if (!capabilityIds.has(mapping.id)) fail(`capability map has unknown ID: ${mapping.id}`);
  for (const served of mapping.scenarios_served) {
    if (!scenarioIds.has(served) && !familyIds.has(served)) fail(`${mapping.id} has unknown scenarios_served value: ${served}`);
  }
  for (const sourcePath of mapping.source_paths) {
    if (sourcePath.replaceAll("\\", "/").startsWith("extension/dist/")) fail(`${mapping.id} references generated extension output: ${sourcePath}`);
    if (!await pathExists(sourcePath)) fail(`${mapping.id} references missing source path: ${sourcePath}`);
  }
  for (const ref of mapping.issue_refs) {
    if (mapping.pr_refs.includes(ref)) fail(`${mapping.id} classifies ${ref} as both an issue and a pull request`);
  }
}

for (const mapping of existingEvidenceDocument.mappings) {
  if (!scenarioIds.has(mapping.primary_scenario_id)) fail(`${mapping.id} has unknown primary scenario: ${mapping.primary_scenario_id}`);
  requireResolved(`${mapping.id} supporting scenario`, mapping.supporting_scenario_ids, scenarioIds);
  for (const sourcePath of mapping.paths) {
    if (sourcePath.replaceAll("\\", "/").startsWith("extension/dist/")) fail(`${mapping.id} references generated extension output: ${sourcePath}`);
    if (!await pathExists(sourcePath)) fail(`${mapping.id} references missing path: ${sourcePath}`);
  }
  for (const ref of mapping.issue_refs) {
    if (mapping.pr_refs.includes(ref)) fail(`${mapping.id} classifies ${ref} as both an issue and a pull request`);
  }
}

for (const entry of issueMapDocument.entries) {
  for (const programmeId of entry.programme_ids) {
    if (!capabilityIds.has(programmeId) && !scenarioIds.has(programmeId)) fail(`issue-map entry has unknown programme ID: ${programmeId}`);
  }
  for (const ref of entry.issue_refs) {
    if (entry.pr_refs.includes(ref)) fail(`issue-map classifies ${ref} as both an issue and a pull request`);
  }
}
if (issueMapDocument.new_issues_created !== 0) fail("seed pass unexpectedly records new GitHub issues");
if (issueMapDocument.scenario_issue_count > 12) fail(`scenario issue ceiling exceeded: ${issueMapDocument.scenario_issue_count}`);

const provenance = documents.get("registry/SOURCE_PROVENANCE.json");
requireCount("source bundle file", provenance.source_bundle_file_count, provenance.files);
requireUnique("source bundle path", provenance.files.map((file) => file.path));
requireUnique("imported output path", provenance.imported_outputs.map((file) => file.path));
for (const output of provenance.imported_outputs) {
  let value;
  try {
    value = JSON.parse(await readFile(path.join(root, output.path), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      fail(`tracked imported output is missing: ${output.path}`);
      continue;
    }
    throw error;
  }
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  if (digest !== output.semantic_sha256) fail(`tracked imported output semantic drift: ${output.path}`);
}

const sourceBundleDirectory = path.join(root, "RESOURCES", "DefenseVectors");
let sourceBundleVerified = false;
if (requireSourceBundle) {
  let sourceBundleAvailable = true;
  try {
    await stat(sourceBundleDirectory);
  } catch (error) {
    if (error.code === "ENOENT") sourceBundleAvailable = false;
    else throw error;
  }
  if (!sourceBundleAvailable) {
    fail("the supplied RESOURCES/DefenseVectors bundle is required for this check but is not present");
  } else {
    sourceBundleVerified = true;
    const physicalBundlePaths = (await allFiles(sourceBundleDirectory))
      .map((file) => path.relative(root, file).replaceAll("\\", "/"))
      .sort();
    const recordedBundlePaths = provenance.files.map((file) => file.path).sort();
    if (JSON.stringify(physicalBundlePaths) !== JSON.stringify(recordedBundlePaths)) {
      fail(`source bundle inventory drift: recorded ${recordedBundlePaths.length}, found ${physicalBundlePaths.length}`);
    }
    for (const file of provenance.files) {
      const bytes = await readFile(path.join(root, file.path));
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== file.sha256) fail(`source provenance hash drift: ${file.path}`);
    }
  }
}

const mappedHtmlPaths = new Set(
  existingEvidenceDocument.mappings.flatMap((mapping) => mapping.paths).filter((sourcePath) => sourcePath.startsWith("gym/") && sourcePath.endsWith(".html")),
);
const flaggedFixturePaths = new Set(fixtureSafetyDocument.findings.map((finding) => finding.path));
for (const finding of fixtureSafetyDocument.findings) {
  if (!mappedHtmlPaths.has(finding.path)) fail(`fixture safety finding is not a mapped HTML fixture: ${finding.path}`);
  if (!await pathExists(finding.path)) fail(`fixture safety finding path is missing: ${finding.path}`);
  const detected = unsafeFixtureFindings(await readFile(path.join(root, finding.path), "utf8"));
  if (detected.length === 0) fail(`fixture safety finding is stale and needs reconciliation: ${finding.path}`);
  if (finding.disposition === "QUARANTINED" && !finding.classifications.includes("COMMAND_SHAPED")) {
    fail(`quarantined fixture lacks COMMAND_SHAPED classification: ${finding.path}`);
  }
}
for (const sourcePath of mappedHtmlPaths) {
  const detected = unsafeFixtureFindings(await readFile(path.join(root, sourcePath), "utf8"));
  if (detected.length > 0 && !flaggedFixturePaths.has(sourcePath)) {
    fail(`mapped fixture has unflagged unsafe content: ${sourcePath} (${detected.join("; ")})`);
  }
}
const evidenceOrder = new Map(evidenceDocument.evidence_states.map((state) => [state.id, state.order]));
for (const mapping of existingEvidenceDocument.mappings) {
  if (mapping.paths.some((sourcePath) => flaggedFixturePaths.has(sourcePath)) && evidenceOrder.get(mapping.evidence_state) > evidenceOrder.get("MODELLED")) {
    fail(`${mapping.id} promotes a safety-held fixture beyond MODELLED`);
  }
}

if (unsafeFixtureFindings("Use https://sink.test and an inert sentinel only.").length !== 0) fail("unsafe-content scanner rejected its reserved-origin control");
if (unsafeFixtureFindings("send to https://attacker.example/collect").length === 0) fail("unsafe-content scanner missed a public target");
if (unsafeFixtureFindings("powershell.exe -EncodedCommand AAAA").length === 0) fail("unsafe-content scanner missed an executable command pattern");

await validateLocalMarkdownLinks();

if (errors.length > 0) {
  console.error(`Security-program validation failed with ${errors.length} finding(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${scenariosDocument.scenario_count} scenarios, ${capabilitiesDocument.capability_count} capabilities, ${existingEvidenceDocument.mapping_count} evidence mappings, and ${backlogDocument.task_count} local work units.`);
  console.log(`Schema, uniqueness, dependency, count, ${sourceBundleVerified ? "source and tracked" : "tracked"} provenance, path, link, and unsafe-content checks passed.`);
}
