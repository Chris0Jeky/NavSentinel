/**
 * Test-only synchronous MAIN-queue observation for #963/#954. This is a
 * diagnostic copy, never a release artifact or an owner Gate-3 result.
 *
 * The row-8 spec creates and cleans up its own observed copy automatically.
 * Its EXTENSION_PATH input is the source fixed or pr599-regressed bundle, never
 * an already-observed copy. This CLI is only for inspecting the transformation.
 * Both copies keep the original queue policy and bridge scheduling;
 * observation adds no timers or messages.
 *
 * node tests/acceptance/clipboard-pressure-observed-bundle.ts [source dist] [output root]
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const PRESSURE_OBSERVER_MARKER = "navsentinel-clipboard-queue-test.json";
export const PRESSURE_OBSERVER_PROPERTY = "__navsentinelClipboardQueueTestEvidence";
export const PRESSURE_OBSERVER_SCHEMA = "navsentinel-clipboard-queue-test/v2";
const OBSERVER = "__nsClipboardQueueObserver963";

type Counts = { clipboardEnqueueCalls: number; commandLike: number; other: number };
export type ClipboardQueueEvidence = {
  schema: typeof PRESSURE_OBSERVER_SCHEMA;
  artifactId: string;
  verificationCount: number;
  queuedAfterVerification: number;
  drainCount: number;
  drainsBeforeVerification: number;
  firstVerification: (Counts & { queueSize: number; dropped: number; coalesced: number }) | null;
  firstDrain: { verificationCount: number; total: number; commandLike: number; other: number; dropped: number; coalesced: number } | null;
};

function fail(message: string): never { throw new Error(`TEST_INVALID: ${message}`); }
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Hash ordinary bundle files; exclude the marker by default to avoid recursion. */
export function hashClipboardPressureBundle(root: string, includeObserverMarker = false): string {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) {
        if (includeObserverMarker || target !== path.join(root, PRESSURE_OBSERVER_MARKER)) files.push(target);
      } else fail("observed bundle must contain only ordinary files and directories");
    }
  };
  visit(root);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(path.relative(root, file).replaceAll("\\", "/"));
    hash.update("\0"); hash.update(fs.readFileSync(file)); hash.update("\0");
  }
  return hash.digest("hex");
}

function nodes<T extends ts.Node>(root: ts.Node, guard: (node: ts.Node) => node is T): T[] {
  const matches: T[] = [];
  const visit = (node: ts.Node) => {
    if (guard(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function only<T>(items: T[], label: string): T {
  if (items.length !== 1) fail(`expected exactly one ${label}, found ${items.length}`);
  return items[0]!;
}

/** Locate the real compiled queue branch and accepted challenge, regardless of minified names. */
export function instrumentClipboardQueue(source: string, artifactId: string): string {
  if (source.includes(OBSERVER) || source.includes(PRESSURE_OBSERVER_PROPERTY)) fail("bundle already has a queue observer");
  const file = ts.createSourceFile("guard.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const ready = only(nodes(file, ts.isCallExpression).filter((call) => {
    const argument = call.arguments[0];
    return argument && ts.isStringLiteralLike(argument) && argument.text === "ns-bridge-ready";
  }), "MAIN bridge-ready call");
  if (!ts.isIdentifier(ready.expression)) fail("bridge-ready sender is not a private function");
  const postName = ready.expression.text;
  const post = only(nodes(file, ts.isFunctionDeclaration).filter((fn) => fn.name?.text === postName), "MAIN sender declaration");
  const queueCall = only(nodes(post, ts.isCallExpression).filter((call) =>
    ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "enqueue"), "MAIN enqueue call");
  if (!ts.isPropertyAccessExpression(queueCall.expression) || !ts.isIdentifier(queueCall.expression.expression)) fail("queue is not a private binding");
  const queueName = queueCall.expression.expression.text;
  const message = queueCall.arguments[0];
  if (!message || !ts.isIdentifier(message) || !ts.isExpressionStatement(queueCall.parent)) fail("queue admission shape changed");
  const branch = only(nodes(post, ts.isIfStatement).filter((statement) =>
    queueCall.pos >= statement.thenStatement.pos && queueCall.end <= statement.thenStatement.end), "queue admission branch");
  const terms = branch.expression.getText(file).replace(/\s/gu, "").split("||");
  if (terms.length !== 3 || !terms.every((term) => /^![A-Za-z_$][\w$]*$/u.test(term))) fail("queue readiness predicate changed");
  const verifiedName = terms[2]!.slice(1);
  const verified = only(nodes(file, ts.isBinaryExpression).filter((node) => {
    if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(node.left) || node.left.text !== verifiedName) return false;
    return node.right.kind === ts.SyntaxKind.TrueKeyword || node.right.getText(file) === "!0";
  }), "accepted bridge verification assignment");
  // Both operations must belong to the same accepted-challenge callback, in
  // that order. Refuse an unfamiliar build instead of guessing at its boundary.
  const enclosingFunction = (node: ts.Node): ts.Node | undefined => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) return parent;
    }
    return undefined;
  };
  const handler = enclosingFunction(verified);
  if (!handler || handler !== enclosingFunction(ready) || verified.end >= ready.pos ||
      !handler.getText(file).includes("ns-challenge-response")) fail("accepted challenge ordering changed");

  const drain = only(nodes(file, ts.isCallExpression).filter((call) =>
    ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === queueName && call.expression.name.text === "drain"), "MAIN queue drain");
  let flush: ts.Node | undefined = drain.parent;
  while (flush && !ts.isFunctionDeclaration(flush)) flush = flush.parent;
  if (!flush || !ts.isFunctionDeclaration(flush) || !flush.name || !ts.isVariableDeclaration(drain.parent) ||
      drain.parent.initializer !== drain || !ts.isObjectBindingPattern(drain.parent.name)) fail("MAIN flush declaration changed");
  const items = only(drain.parent.name.elements.filter((entry) =>
    (entry.propertyName ?? entry.name).getText(file) === "items" && ts.isIdentifier(entry.name)), "drain items binding");
  // #1141 drains by index so a page-replaced array iterator never sees the messages.
  const itemsName = items.name.getText(file);
  const sendLoop = only(nodes(flush, (node): node is ts.ForOfStatement | ts.ForStatement =>
    ts.isForOfStatement(node) || ts.isForStatement(node)).filter((loop) =>
    (ts.isForOfStatement(loop) ? loop.expression.getText(file) === itemsName
      : loop.condition?.getText(file).replace(/\s/gu, "").endsWith(`<${itemsName}.length`)) &&
    nodes(loop, ts.isCallExpression).some((call) =>
      ts.isIdentifier(call.expression) && call.expression.text === postName)), "drained-message send loop");
  const flushName = flush.name.text;
  const flushCall = only(nodes(file, ts.isCallExpression).filter((call) =>
    ts.isIdentifier(call.expression) && call.expression.text === flushName), "accepted challenge flush call");
  if (drain.end >= sendLoop.pos || enclosingFunction(flushCall) !== handler || flushCall.pos <= ready.end) {
    fail("MAIN drain/verification/flush ordering changed");
  }

  const edits = [
    { start: queueCall.parent.end, end: queueCall.parent.end,
      text: `${OBSERVER}.queued(${message.text},${verifiedName});` },
    { start: verified.getStart(file), end: verified.end,
      text: `(${verified.getText(file)},${OBSERVER}.verified(${queueName}),true)` },
    { start: drain.getStart(file), end: drain.end,
      text: `${OBSERVER}.drained(${drain.getText(file)})` },
  ].sort((left, right) => right.start - left.start);
  let patched = source;
  for (const edit of edits) patched = patched.slice(0, edit.start) + edit.text + patched.slice(edit.end);
  // Only counters live here. No page callbacks, clipboard contents, timestamps,
  // postMessage, DOM writes, or scheduling changes execute at these boundaries.
  const prelude = `const ${OBSERVER}=(()=>{
    const counts={clipboardEnqueueCalls:0,commandLike:0,other:0};
    let verificationCount=0,queuedAfterVerification=0,drainCount=0,drainsBeforeVerification=0,firstVerification=null,firstDrain=null;
    Object.defineProperty(globalThis,${JSON.stringify(PRESSURE_OBSERVER_PROPERTY)},{
      configurable:false,get:()=>({schema:${JSON.stringify(PRESSURE_OBSERVER_SCHEMA)},artifactId:${JSON.stringify(artifactId)},
        verificationCount,queuedAfterVerification,drainCount,drainsBeforeVerification,
        firstVerification:firstVerification&&{...firstVerification},firstDrain:firstDrain&&{...firstDrain}})
    });
    return {
      queued(message,verified){
        if(message.type!=="ns-clipboard-write")return;
        if(verified||verificationCount){queuedAfterVerification++;return;}
        counts.clipboardEnqueueCalls++;
        if(message.payload?.looksLikeCommand===true)counts.commandLike++;else counts.other++;
      },
      verified(queue){
        verificationCount++;
        if(verificationCount===1)firstVerification={...counts,queueSize:queue.size,dropped:queue.droppedCount,coalesced:queue.coalescedCount};
      },
      drained(result){
        drainCount++;
        if(!verificationCount)drainsBeforeVerification++;
        if(drainCount===1){
          let commandLike=0,other=0;
          for(const message of result.items){
            if(message.type!=="ns-clipboard-write")continue;
            if(message.payload?.looksLikeCommand===true)commandLike++;else other++;
          }
          firstDrain={verificationCount,total:result.items.length,commandLike,other,dropped:result.dropped,coalesced:result.coalesced};
        }
        return result;
      }
    };
  })();\n`;
  return prelude + patched;
}

export type ObserverMarker = {
  schema: typeof PRESSURE_OBSERVER_SCHEMA;
  classification: "TEST_ONLY_INSTRUMENTED_COPY_NOT_RELEASE_EVIDENCE";
  artifactId: string;
  sourceDist: string;
  patchedAsset: string;
  sourceSha256: string;
  observedSha256: string;
  sourceBundleSha256: string;
  /** Excludes PRESSURE_OBSERVER_MARKER; the acceptance receipt also hashes the complete copy. */
  observedBundleSha256: string;
};

export function buildClipboardPressureObservedBundle(sourceDist: string, outputRoot: string, artifactId = randomUUID()): { extensionPath: string; marker: ObserverMarker } {
  if (!fs.existsSync(path.join(sourceDist, "manifest.json"))) fail(`no built extension at ${sourceDist}`);
  if (fs.existsSync(path.join(sourceDist, PRESSURE_OBSERVER_MARKER))) fail("source is already instrumented");
  const assets = path.join(sourceDist, "assets");
  const candidates = fs.readdirSync(assets).filter((name) => /^main_guard\.ts-.*\.js$/u.test(name))
    .filter((name) => fs.readFileSync(path.join(assets, name), "utf8").includes("ns-challenge-response"));
  const patchedAsset = only(candidates, "built MAIN guard module");
  const source = fs.readFileSync(path.join(assets, patchedAsset), "utf8");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(artifactId)) fail("invalid diagnostic artifact identifier");
  const observed = instrumentClipboardQueue(source, artifactId);
  const extensionPath = path.join(outputRoot, "extension");
  if (fs.existsSync(extensionPath)) fail(`${extensionPath} already exists`);
  const sourceBundleSha256 = hashClipboardPressureBundle(sourceDist);
  fs.cpSync(sourceDist, extensionPath, { recursive: true });
  if (hashClipboardPressureBundle(extensionPath) !== sourceBundleSha256) fail("source bundle changed while copying");
  fs.writeFileSync(path.join(extensionPath, "assets", patchedAsset), observed);
  const marker: ObserverMarker = {
    schema: PRESSURE_OBSERVER_SCHEMA,
    classification: "TEST_ONLY_INSTRUMENTED_COPY_NOT_RELEASE_EVIDENCE",
    artifactId, sourceDist: path.resolve(sourceDist), patchedAsset,
    sourceSha256: sha256(source), observedSha256: sha256(observed),
    sourceBundleSha256, observedBundleSha256: hashClipboardPressureBundle(extensionPath),
  };
  fs.writeFileSync(path.join(extensionPath, PRESSURE_OBSERVER_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
  return { extensionPath, marker };
}

export function readClipboardPressureObserverMarker(extensionPath: string): ObserverMarker {
  const markerPath = path.join(extensionPath, PRESSURE_OBSERVER_MARKER);
  if (!fs.existsSync(markerPath)) fail("row 8 needs a marked diagnostic copy from clipboard-pressure-observed-bundle.ts");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as ObserverMarker;
  if (marker.schema !== PRESSURE_OBSERVER_SCHEMA || marker.classification !== "TEST_ONLY_INSTRUMENTED_COPY_NOT_RELEASE_EVIDENCE" ||
      typeof marker.artifactId !== "string" || !marker.artifactId || typeof marker.patchedAsset !== "string" ||
      path.basename(marker.patchedAsset) !== marker.patchedAsset ||
      !/^[a-f0-9]{64}$/u.test(marker.sourceSha256) || !/^[a-f0-9]{64}$/u.test(marker.sourceBundleSha256)) fail("invalid observer artifact marker");
  const source = fs.readFileSync(path.join(extensionPath, "assets", marker.patchedAsset), "utf8");
  if (sha256(source) !== marker.observedSha256) fail("observed MAIN module hash does not match its marker");
  if (hashClipboardPressureBundle(extensionPath) !== marker.observedBundleSha256) fail("observed bundle hash does not match its marker");
  return marker;
}

/** Own the copy across builder failures, failed browser opens, and normal session close. */
export async function withClipboardPressureObservedBundle<T>(sourceDist: string,
  run: (bundle: { extensionPath: string; marker: ObserverMarker }) => Promise<T>): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-pressure-observed-"));
  try {
    return await run(buildClipboardPressureObservedBundle(sourceDist, root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const sourceDist = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repoRoot, "extension", "dist");
  const outputRoot = process.argv[3] ? path.resolve(process.argv[3]) : fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-pressure-observed-"));
  console.log(buildClipboardPressureObservedBundle(sourceDist, outputRoot).extensionPath);
}
