/** Compare fixed scenario outcomes and strictly certify the bounded diagnostic traces. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  FORM_CONTROL_VARIANTS,
  FORM_EVIDENCE_POLICY,
  FORM_GAP_CODES,
  FORM_PAIRED_VARIANTS,
  FORM_REQUIRED_OBSERVATION_MS,
  FORM_SCENARIO_ID,
  FORM_TRACE_MODE,
  FORM_TRACE_SCHEMA,
  expectedKeys,
  requiredFormReportsPresent,
} from "./trace-contract.mjs";

export { expectedKeys };

const TOP_LEVEL_KEYS = [
  "browserVersion", "completed", "dropped", "events", "evidencePolicy", "gaps",
  "identity", "mode", "pairId", "protectedArm", "requiredObservationMs", "runId",
  "scenarioId", "schema", "variant",
].sort();
const DOCUMENT_TRACE_SCHEMA = "navsentinel.observatory.form.v2";
const DOCUMENT_BINDING_POLICY = "CDP_DEFAULT_WORLD_DOCUMENT";
const DOCUMENT_EXPERIMENTS = new Set([
  "form-campaign", "same-url-siblings", "same-frame-reload", "same-document-navigation",
  "frame-replacement", "spoofed-identity-disposal", "borrowed-reporting-function",
]);
const DOCUMENT_TOP_LEVEL_KEYS = [...TOP_LEVEL_KEYS, "bindingPolicy", "experiment"].sort();
const IDENTITY_KEYS = ["extensionSha256", "fixtureSha256", "head", "tree"].sort();
const EVENT_KEYS = ["data", "elapsedMs", "id", "kind", "sequence", "source"].sort();
const EVENT_BINDING_KEYS = [...EVENT_KEYS, "binding"].sort();
const BINDING_KEYS = ["documentId", "frameId", "scope"].sort();
const INTENT_KEYS = [
  "action", "actionSource", "declaredAction", "encoding", "form", "method",
  "methodOverride", "ownerMatches", "submitter", "target", "targetOverride",
  "targetSource",
].sort();
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BROWSER_VERSION = /^[0-9]+(?:\.[0-9]+){1,4}$/;
const SOURCES = new Set(["runner", "page", "browser", "sink", "extension"]);
const REPORT_PHASES = new Set(["input", "operation", "submit-event", "late-mutation", "prepared"]);
const REPORT_PRIMITIVES = new Set(["native", "submit", "requestSubmit", "location"]);
const GAP_CODES = new Set(FORM_GAP_CODES);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, expected) {
  return object(value) && Object.keys(value).sort().join("\0") === expected.join("\0");
}
function oneOf(value, choices) {
  return typeof value === "string" && choices.includes(value);
}
function validBinding(value) {
  return exactKeys(value, BINDING_KEYS) && /^frame-[1-9][0-9]{0,2}$/.test(value.frameId) &&
    /^document-[1-9][0-9]{0,2}$/.test(value.documentId) && oneOf(value.scope, ["top", "child"]);
}
function integer(value, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && value >= min && value <= max;
}
function add(differences, code, key) {
  differences.push(`${code}:${key}`);
}

function normalized(rows) {
  if (!Array.isArray(rows) || rows.length !== expectedKeys.length) throw Error("FORM_RESULT_COUNT");
  const map = new Map();
  for (const row of rows) {
    if (!row || Object.keys(row).sort().join() !== "atFixture,atSink,attempts,dialogClosed,protectedArm,variant" ||
        typeof row.protectedArm !== "boolean" || typeof row.atFixture !== "boolean" ||
        typeof row.atSink !== "boolean" || typeof row.dialogClosed !== "boolean" ||
        !Array.isArray(row.attempts) || row.attempts.length > 16) {
      throw Error("FORM_RESULT_INVALID");
    }
    const key = `${row.variant}:${row.protectedArm}`;
    if (!expectedKeys.includes(key) || map.has(key)) throw Error("FORM_RESULT_DUPLICATE_OR_UNKNOWN");
    row.attempts.forEach((receipt, index) => {
      if (!receipt || Object.keys(receipt).sort().join() !== "accepted,method,ordinal,role" ||
          !["harm", "benign"].includes(receipt.role) || !["GET", "POST"].includes(receipt.method) ||
          typeof receipt.accepted !== "boolean" || receipt.ordinal !== index + 1) {
        throw Error("FORM_RECEIVER_INVALID");
      }
    });
    map.set(key, {
      attempts: row.attempts.map((receipt) => [receipt.role, receipt.method, receipt.accepted, receipt.ordinal]),
      atFixture: row.atFixture,
      atSink: row.atSink,
      dialogClosed: row.dialogClosed,
    });
  }
  return map;
}

export function compareFormOutcomes(full, control) {
  try {
    const observed = normalized(full);
    const baseline = normalized(control);
    const differences = expectedKeys.filter((key) => JSON.stringify(observed.get(key)) !== JSON.stringify(baseline.get(key)));
    return {
      schema: "navsentinel.form-observer-parity.v1",
      matched: differences.length === 0,
      cases: expectedKeys.length,
      differences,
      evidencePolicy: "CONSEQUENCE_PARITY_NOT_ZERO_OBSERVER_EFFECT",
    };
  } catch (error) {
    return { schema: "navsentinel.form-observer-parity.v1", matched: false, cases: 0, error: error.message };
  }
}

function validateIntent(intent) {
  if (!exactKeys(intent, INTENT_KEYS)) return false;
  return oneOf(intent.form, ["f", "g", "other"]) &&
    oneOf(intent.submitter, ["a", "b", "none", "other"]) &&
    oneOf(intent.action, ["harm", "benign", "fixture", "other"]) &&
    oneOf(intent.declaredAction, ["harm", "benign", "fixture", "other"]) &&
    oneOf(intent.actionSource, ["form", "submitter"]) &&
    oneOf(intent.method, ["GET", "POST", "DIALOG"]) &&
    oneOf(intent.encoding, ["urlencoded", "multipart", "plain"]) &&
    oneOf(intent.target, ["self", "top", "parent", "blank", "named"]) &&
    oneOf(intent.targetSource, ["form", "submitter", "base", "default"]) &&
    oneOf(intent.targetOverride, ["absent", "empty", "present"]) &&
    oneOf(intent.methodOverride, ["absent", "empty", "present"]) &&
    typeof intent.ownerMatches === "boolean";
}

function validateEvent(event, index, previousElapsed, key, differences, documentBound) {
  const hasBinding = documentBound && exactKeys(event, EVENT_BINDING_KEYS);
  if (!exactKeys(event, EVENT_KEYS) && !hasBinding) {
    add(differences, "FORM_TRACE_EVENT_FIELDS", key);
    return previousElapsed;
  }
  if (event.id !== `e${index + 1}` || event.sequence !== index + 1) {
    add(differences, "FORM_TRACE_EVENT_IDENTITY", key);
  }
  if (!Number.isFinite(event.elapsedMs) || event.elapsedMs < previousElapsed || event.elapsedMs > 86_400_000 ||
      (index === 0 && event.elapsedMs !== 0)) {
    add(differences, "FORM_TRACE_EVENT_TIME", key);
  }
  if (!SOURCES.has(event.source) || typeof event.kind !== "string" || !object(event.data)) {
    add(differences, "FORM_TRACE_EVENT_SHAPE", key);
    return Number.isFinite(event.elapsedMs) ? Math.max(previousElapsed, event.elapsedMs) : previousElapsed;
  }

  let valid = false;
  switch (event.kind) {
    case "run.start":
    case "observation.end":
      valid = event.source === "runner" && exactKeys(event.data, []) && !hasBinding;
      break;
    case "form.intent":
      valid = event.source === "page" && exactKeys(event.data, ["intent", "phase", "primitive"]) &&
        REPORT_PHASES.has(event.data.phase) && REPORT_PRIMITIVES.has(event.data.primitive) &&
        validateIntent(event.data.intent) && (documentBound ? hasBinding && validBinding(event.binding) : !hasBinding);
      break;
    case "document.started":
      valid = documentBound && event.source === "browser" && exactKeys(event.data, []) && hasBinding && validBinding(event.binding);
      break;
    case "document.ended":
      valid = documentBound && event.source === "browser" && exactKeys(event.data, ["reason"]) &&
        oneOf(event.data.reason, ["navigation", "context-destroyed", "contexts-cleared", "frame-detached", "collector-closed", "context-replaced"]) &&
        hasBinding && validBinding(event.binding);
      break;
    case "receiver.health":
      valid = event.source === "sink" && exactKeys(event.data, ["ok", "phase", "sequence"]) &&
        oneOf(event.data.phase, ["start", "end"]) && event.data.ok === true &&
        integer(event.data.sequence, 1, 1_000_000) && !hasBinding;
      break;
    case "receiver.attempt":
      valid = event.source === "sink" && exactKeys(event.data, ["accepted", "method", "ordinal", "role"]) &&
        oneOf(event.data.role, ["harm", "benign"]) && oneOf(event.data.method, ["GET", "POST", "OTHER"]) &&
        typeof event.data.accepted === "boolean" && integer(event.data.ordinal, 1, 16) && !hasBinding;
      break;
    case "navigation.committed":
      valid = event.source === "browser" && exactKeys(event.data, ["destination", "scope"]) &&
        oneOf(event.data.scope, ["top", "child"]) &&
        oneOf(event.data.destination, ["fixture", "harm", "benign", "other"]) && !hasBinding;
      break;
    case "input.dispatched":
      valid = event.source === "runner" && exactKeys(event.data, ["action"]) &&
        oneOf(event.data.action, ["click", "synthetic-click", "allow-once", "fill-required"]) && !hasBinding;
      break;
    case "decision.report":
      valid = event.source === "extension" && exactKeys(event.data, ["code"]) &&
        oneOf(event.data.code, ["form-blocked", "navigation-blocked", "navigation-rollback", "other-decision"]) && !hasBinding;
      break;
    default:
      valid = false;
  }
  if (!valid) add(differences, "FORM_TRACE_EVENT_CONTRACT", key);
  return Number.isFinite(event.elapsedMs) ? Math.max(previousElapsed, event.elapsedMs) : previousElapsed;
}

function validateDocumentLifetimes(events, key, differences) {
  const seenDocuments = new Set();
  const activeDocuments = new Map();
  const activeFrames = new Map();
  const frameScopes = new Map();
  const reject = () => add(differences, "FORM_TRACE_DOCUMENT_LIFECYCLE", key);
  for (const event of events) {
    const binding = event?.binding;
    if (event?.kind === "document.started") {
      if (!validBinding(binding)) { reject(); continue; }
      if (seenDocuments.has(binding.documentId) || activeDocuments.has(binding.documentId) || activeFrames.has(binding.frameId) ||
          (frameScopes.has(binding.frameId) && frameScopes.get(binding.frameId) !== binding.scope)) {
        reject();
        continue;
      }
      seenDocuments.add(binding.documentId);
      activeDocuments.set(binding.documentId, { frameId: binding.frameId, scope: binding.scope });
      activeFrames.set(binding.frameId, binding.documentId);
      frameScopes.set(binding.frameId, binding.scope);
    } else if (event?.kind === "document.ended") {
      if (!validBinding(binding)) { reject(); continue; }
      const active = activeDocuments.get(binding.documentId);
      if (!active || active.frameId !== binding.frameId || active.scope !== binding.scope) {
        reject();
        continue;
      }
      activeDocuments.delete(binding.documentId);
      activeFrames.delete(binding.frameId);
    } else if (event?.kind === "form.intent") {
      if (!validBinding(binding)) { reject(); continue; }
      const active = activeDocuments.get(binding.documentId);
      if (!active || active.frameId !== binding.frameId || active.scope !== binding.scope) reject();
    }
  }
  if (activeDocuments.size !== 0) reject();
}

function validateTrace(row, index, differences, campaign) {
  const fallbackKey = `row-${index}`;
  const documentBound = row?.schema === DOCUMENT_TRACE_SCHEMA;
  if (!exactKeys(row, documentBound ? DOCUMENT_TOP_LEVEL_KEYS : TOP_LEVEL_KEYS)) {
    add(differences, "FORM_TRACE_FIELDS", fallbackKey);
    return;
  }
  const key = `${row.variant}:${row.protectedArm}`;
  if (!expectedKeys.includes(key) || campaign.keys.has(key)) {
    add(differences, "FORM_TRACE_DUPLICATE_OR_UNKNOWN", key);
  } else {
    campaign.keys.add(key);
  }
  if (typeof row.protectedArm !== "boolean") add(differences, "FORM_TRACE_ARM_TYPE", key);
  if ((!documentBound && row.schema !== FORM_TRACE_SCHEMA) || row.mode !== FORM_TRACE_MODE || row.scenarioId !== FORM_SCENARIO_ID ||
      row.requiredObservationMs !== FORM_REQUIRED_OBSERVATION_MS || row.evidencePolicy !== FORM_EVIDENCE_POLICY ||
      (documentBound && (row.bindingPolicy !== DOCUMENT_BINDING_POLICY || !DOCUMENT_EXPERIMENTS.has(row.experiment)))) {
    add(differences, "FORM_TRACE_CONTRACT", key);
  }
  if (!HEX64.test(row.pairId) || !UUID_V4.test(row.runId) || !BROWSER_VERSION.test(row.browserVersion)) {
    add(differences, "FORM_TRACE_ID", key);
  }
  if (campaign.runIds.has(row.runId)) add(differences, "FORM_TRACE_RUN_DUPLICATE", key);
  else campaign.runIds.add(row.runId);

  if (!exactKeys(row.identity, IDENTITY_KEYS) || !HEX40.test(row.identity?.head) || !HEX40.test(row.identity?.tree) ||
      !HEX64.test(row.identity?.extensionSha256) || !HEX64.test(row.identity?.fixtureSha256)) {
    add(differences, "FORM_TRACE_SOURCE_IDENTITY", key);
  } else {
    campaign.identities.add(JSON.stringify(row.identity));
  }
  if (row.completed !== true) add(differences, "FORM_TRACE_INCOMPLETE", key);
  if (!integer(row.dropped, 0, 1_000_000) || row.dropped !== 0) add(differences, "FORM_TRACE_DROPPED", key);
  if (!Array.isArray(row.gaps) || row.gaps.some((gap) => typeof gap !== "string" || !GAP_CODES.has(gap)) || row.gaps.length !== 0) {
    add(differences, "FORM_TRACE_GAPS", key);
  }
  if (!Array.isArray(row.events) || row.events.length < 5 || row.events.length > 512) {
    add(differences, "FORM_TRACE_EVENTS", key);
    return;
  }

  let previousElapsed = 0;
  for (const [eventIndex, event] of row.events.entries()) {
    previousElapsed = validateEvent(event, eventIndex, previousElapsed, key, differences, documentBound);
  }
  const runStarts = row.events.filter((event) => event?.kind === "run.start");
  const ends = row.events.filter((event) => event?.kind === "observation.end");
  if (runStarts.length !== 1 || row.events[0]?.kind !== "run.start" ||
      ends.length !== 1 || row.events.at(-1)?.kind !== "observation.end") {
    add(differences, "FORM_TRACE_TERMINALS", key);
  }
  const health = row.events.filter((event) => event?.kind === "receiver.health");
  const healthStartIndex = row.events.indexOf(health[0]);
  const healthEndIndex = row.events.indexOf(health[1]);
  const healthComplete = health.length === 2 && health[0]?.data?.phase === "start" && health[0]?.data?.sequence === 1 &&
    health[1]?.data?.phase === "end" && health[1]?.data?.sequence === 2 && healthStartIndex < healthEndIndex;
  const outsideHealth = healthComplete && row.events.some((event, eventIndex) =>
    !["run.start", "observation.end", "receiver.health"].includes(event?.kind) &&
    (eventIndex <= healthStartIndex || eventIndex >= healthEndIndex));
  if (!healthComplete || outsideHealth) {
    add(differences, "FORM_TRACE_HEALTH", key);
  }
  if (!requiredFormReportsPresent(row.events, row.variant, row.protectedArm)) {
    add(differences, "FORM_TRACE_REPORT_SEQUENCE", key);
  }
  if (documentBound) {
    const documentStarts = row.events.filter((event) => event?.kind === "document.started");
    const documentEnds = row.events.filter((event) => event?.kind === "document.ended");
    if (documentStarts.length === 0) add(differences, "FORM_TRACE_DOCUMENT_START", key);
    if (documentEnds.length === 0) add(differences, "FORM_TRACE_DOCUMENT_END", key);
    validateDocumentLifetimes(row.events, key, differences);
  }

  const pairOwner = campaign.pairOwners.get(row.pairId);
  if (pairOwner !== undefined && pairOwner !== row.variant) add(differences, "FORM_TRACE_PAIR_REUSED", key);
  else campaign.pairOwners.set(row.pairId, row.variant);
  const variantRows = campaign.byVariant.get(row.variant) ?? [];
  variantRows.push(row);
  campaign.byVariant.set(row.variant, variantRows);
}

export function validateFormTraces(rows) {
  const differences = [];
  const campaign = {
    keys: new Set(),
    runIds: new Set(),
    identities: new Set(),
    pairOwners: new Map(),
    byVariant: new Map(),
  };
  if (!Array.isArray(rows) || rows.length !== expectedKeys.length) differences.push("FORM_TRACE_COUNT");
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    validateTrace(row, index, differences, campaign);
  }
  for (const key of expectedKeys) {
    if (!campaign.keys.has(key)) differences.push(`FORM_TRACE_MISSING:${key}`);
  }
  if (campaign.identities.size !== 1) differences.push("FORM_TRACE_IDENTITY_MISMATCH");
  for (const variant of FORM_PAIRED_VARIANTS) {
    const variantRows = campaign.byVariant.get(variant) ?? [];
    if (variantRows.length !== 2 || variantRows[0]?.pairId !== variantRows[1]?.pairId) {
      differences.push(`FORM_TRACE_PAIR_MISMATCH:${variant}`);
    }
  }
  for (const variant of FORM_CONTROL_VARIANTS) {
    if ((campaign.byVariant.get(variant) ?? []).length !== 1) differences.push(`FORM_TRACE_CONTROL_COUNT:${variant}`);
  }
  return {
    schema: "navsentinel.form-observer-traces.v1",
    matched: differences.length === 0,
    cases: Array.isArray(rows) ? rows.length : 0,
    differences,
    evidencePolicy: "STRICT_COMPLETE_FORM_TRACE_REQUIRED",
  };
}

/** Receiver agreement is separate from both consequence parity and trace shape. */
function reconcileFormReceivers(rows, results, tracesValid) {
  const result = {
    schema: "navsentinel.form-observer-receivers.v1",
    matched: false,
    cases: 0,
    differences: [],
    evidencePolicy: "EXACT_PER_ARM_RECEIVER_PARITY_NOT_PREVENTION",
  };
  // Do not interpret malformed, missing, duplicated or page-attributed traces
  // as receiver evidence, even if their payloads happen to match a result file.
  if (!tracesValid) return { ...result, error: "FORM_TRACE_INVALID" };
  try {
    const receipts = normalized(results);
    const attemptsByArm = new Map(rows.map((row) => [
      `${row.variant}:${row.protectedArm}`,
      row.events.filter((event) => event.kind === "receiver.attempt").map(({ data }) =>
        [data.role, data.method, data.accepted, data.ordinal]),
    ]));
    // Compare sequences, not sets or totals: zero-attempt arms, accepted/rejected
    // order, duplicate delivery and wrong-arm attribution are all consequential.
    const differences = expectedKeys
      .filter((key) => JSON.stringify(attemptsByArm.get(key)) !== JSON.stringify(receipts.get(key).attempts))
      .map((key) => `FORM_TRACE_RECEIVER_MISMATCH:${key}`);
    return { ...result, matched: differences.length === 0, cases: expectedKeys.length, differences };
  } catch (error) {
    return { ...result, error: error.message };
  }
}

export function compareFormEvidence(full, control, traces) {
  const parityEvidence = compareFormOutcomes(full, control);
  const traceEvidence = validateFormTraces(traces);
  const receiverEvidence = reconcileFormReceivers(traces, full, traceEvidence.matched);
  return {
    ...parityEvidence,
    matched: parityEvidence.matched && traceEvidence.matched && receiverEvidence.matched,
    parityEvidence,
    traceEvidence,
    receiverEvidence,
    evidencePolicy: "CONSEQUENCE_PARITY_AND_STRICT_COMPLETE_FORM_TRACE",
  };
}

function collectJson(root, suffix, sizeLimit) {
  const rows = [];
  let entries = 0;
  const walk = (directory, depth) => {
    if (depth > 8) throw Error("FORM_DIRECTORY_LIMIT");
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++entries > 1024 || entry.isSymbolicLink()) throw Error("FORM_DIRECTORY_LIMIT");
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(suffix)) {
        if (fs.statSync(file).size > sizeLimit) throw Error("FORM_INPUT_SIZE");
        rows.push(JSON.parse(fs.readFileSync(file, "utf8")));
      }
    }
  };
  walk(root, 0);
  return rows;
}
export const collectFormResults = (root) => collectJson(root, ".result.json", 16_384);
export const collectFormTraces = (root) => collectJson(root, ".form-trace.json", 65_536);

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw Error("FORM_ARGUMENTS");
    const fullRoot = process.argv[2];
    const controlRoot = process.argv[3];
    const result = compareFormEvidence(
      collectFormResults(fullRoot), collectFormResults(controlRoot), collectFormTraces(fullRoot),
    );
    console.log(JSON.stringify(result));
    process.exitCode = result.matched ? 0 : 1;
  } catch {
    console.error(JSON.stringify({ error: "FORM_COMPARISON_INPUT_ERROR" }));
    process.exitCode = 2;
  }
}
