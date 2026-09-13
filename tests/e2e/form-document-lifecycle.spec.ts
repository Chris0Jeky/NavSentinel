/** Disposable loopback attribution tests, not attack-prevention qualifications. */
import { chromium, expect, test, type Page, type Frame, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { FormObservation } from "./form_observatory";
import { attachFormDocumentObserver } from "./form_document_observer";
import { startFormIntentLab } from "./form_intent_lab";
import { startProvingGroundEgressFence } from "./proving_ground_fake_sink";
const identity = { head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(), extensionSha256: "0".repeat(64), fixtureSha256: createHash("sha256").update(fs.readFileSync(new URL("./form_intent_lab.ts", import.meta.url))).digest("hex") };
async function report(frame: Frame, phase: "input" | "operation") {
  await frame.evaluate(phase => {
    const api = globalThis as unknown as { __nsFormObservation: (value: unknown) => void };
    api.__nsFormObservation({ phase, primitive: "native", intent: { form: "f", submitter: "a", action: "benign", declaredAction: "benign", actionSource: "form", method: "POST", encoding: "urlencoded", target: "top", targetSource: "form", targetOverride: "absent", methodOverride: "absent", ownerMatches: true } });
  }, phase);
}
async function run(info: TestInfo, action: (page: Page, trace: FormObservation, origin: string, observer: Awaited<ReturnType<typeof attachFormDocumentObserver>>) => Promise<void>) {
  const lab = await startFormIntentLab("exact-request");
  const fence = await startProvingGroundEgressFence([], new Set([lab.fixtureOrigin, lab.sinkOrigin]));
  const trace = new FormObservation({ variant: "exact-request", protectedArm: false, documentBound: true, identity, pairId: createHash("sha256").update(info.testId).digest("hex") });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, observer: Awaited<ReturnType<typeof attachFormDocumentObserver>> | undefined, completed = false;
  try {
    browser = await chromium.launch({ channel: "chromium", proxy: { server: fence.proxyServer }, args: ["--disable-extensions", "--host-resolver-rules=MAP localhost 127.0.0.1"] });
    trace.browser(browser.version()); const context = await browser.newContext(); const page = await context.newPage();
    observer = await attachFormDocumentObserver(page, trace, lab.fixtureOrigin); await page.goto(lab.fixtureOrigin + "/parent");
    await expect.poll(() => trace.currentEvents().filter(e => e.kind === "document.started").length).toBe(2);
    await action(page, trace, lab.fixtureOrigin, observer); completed = true;
  } catch (error) { trace.fail("RUNNER_FAILED"); throw error; }
  finally {
    observer?.prepareToClose();
    try { await browser?.close(); } finally { try { await observer?.dispose(); } finally { await fence.close(); await lab.close(); } }
    await info.attach("document-lifecycle-diagnostic-not-prevention", { contentType: "application/json", body: Buffer.from(JSON.stringify(trace.finish(completed), null, 2)) });
  }
}
test("@regression document attribution keeps same-URL sibling reports separate", async ({}, info) => run(info, async (page, trace, origin) => {
  const first = page.frames().find(f => f.url() === origin + "/child")!;
  await report(first, "input");
  await page.evaluate(() => { const frame = document.createElement("iframe"); frame.id = "sibling"; frame.src = "/child"; document.body.append(frame); });
  await expect.poll(() => page.frames().filter(f => f.url() === origin + "/child").length).toBe(2);
  const sibling = page.frames().find(f => f !== first && f.url() === origin + "/child")!;
  await sibling.waitForFunction(() => typeof (globalThis as unknown as { __nsFormObservation?: unknown }).__nsFormObservation === "function");
  await report(sibling, "operation");
  await expect.poll(() => trace.currentEvents().filter(e => e.kind === "form.intent").length).toBe(2);
  const [a, b] = trace.currentEvents().filter(e => e.kind === "form.intent");
  expect(a!.binding!.frameId).not.toBe(b!.binding!.frameId); expect(a!.binding!.documentId).not.toBe(b!.binding!.documentId);
}));
test("@regression document attribution retires a same-frame same-URL reload", async ({}, info) => run(info, async (page, trace, origin) => {
  const frame = page.frames().find(f => f.url() === origin + "/child")!;
  await report(frame, "input"); await frame.goto(origin + "/child"); await report(frame, "operation");
  await expect.poll(() => trace.currentEvents().filter(e => e.kind === "form.intent").length).toBe(2);
  const [a, b] = trace.currentEvents().filter(e => e.kind === "form.intent");
  expect(a!.binding!.frameId).toBe(b!.binding!.frameId); expect(a!.binding!.documentId).not.toBe(b!.binding!.documentId);
  const end = trace.currentEvents().find(e => e.kind === "document.ended" && e.binding?.documentId === a!.binding!.documentId);
  expect(end?.sequence).toBeLessThan(b!.sequence);
}));
test("@regression same-document navigation keeps its observed realm", async ({}, info) => run(info, async (page, trace, origin) => {
  const frame = page.frames().find(f => f.url() === origin + "/child")!;
  await report(frame, "input"); await frame.evaluate(() => { location.hash = "local-step"; }); await report(frame, "operation");
  await expect.poll(() => trace.currentEvents().filter(e => e.kind === "form.intent").length).toBe(2);
  const events = trace.currentEvents().filter(e => e.kind === "form.intent"); expect(events[0]!.binding).toEqual(events[1]!.binding);
}));
test("@regression removed child and fresh replacement never share document identity", async ({}, info) => run(info, async (page, trace, origin) => {
  await report(page.frames().find(f => f.url() === origin + "/child")!, "input");
  await page.evaluate(() => { document.querySelector("iframe")!.remove(); const f = document.createElement("iframe"); f.src = "/child"; document.body.append(f); });
  await expect.poll(() => trace.currentEvents().filter(e => e.kind === "document.started").length).toBe(3);
  await report(page.frames().find(f => f.url() === origin + "/child")!, "operation");
  await expect.poll(() => trace.currentEvents().filter(e => e.kind === "form.intent").length).toBe(2);
  const [a, b] = trace.currentEvents().filter(e => e.kind === "form.intent"); expect(a!.binding!.frameId).not.toBe(b!.binding!.frameId); expect(a!.binding!.documentId).not.toBe(b!.binding!.documentId);
}));
test("@regression forged identity is rejected and a stopped observer accepts nothing", async ({}, info) => run(info, async (page, trace, origin, observer) => {
  const frame = page.frames().find(f => f.url() === origin + "/child")!;
  await frame.evaluate(() => (globalThis as unknown as { __nsFormObservation: (v: unknown) => void }).__nsFormObservation({ phase: "input", documentId: "document-1", password: "DO_NOT_EXPORT" }));
  await report(frame, "input"); await expect.poll(() => trace.currentEvents().filter(e => e.kind === "form.intent").length).toBe(1);
  await observer.dispose(); const count = trace.currentEvents().length; await report(frame, "operation");
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
  expect(trace.currentEvents()).toHaveLength(count); expect(JSON.stringify(trace.currentEvents())).not.toContain("DO_NOT_EXPORT");
}));
test("@regression borrowed same-origin reporting function does not prove caller identity", async ({}, info) => run(info, async (page, trace, origin) => {
  const first = page.frames().find(f => f.url() === origin + "/child")!;
  await report(first, "input");
  await page.evaluate(() => { const f = document.createElement("iframe"); f.src = "/child"; document.body.append(f); });
  await expect.poll(() => page.frames().filter(f => f.url() === origin + "/child").length).toBe(2);
  const sibling = page.frames().find(f => f !== first && f.url() === origin + "/child")!;
  await sibling.waitForFunction(() => typeof (globalThis as unknown as { __nsFormObservation?: unknown }).__nsFormObservation === "function");
  await sibling.evaluate(() => {
    const donor = parent.frames[0] as unknown as { __nsFormObservation: (v: unknown) => void };
    donor.__nsFormObservation({ phase: "operation", primitive: "native", intent: { form: "f", submitter: "a", action: "benign", declaredAction: "benign", actionSource: "form", method: "POST", encoding: "urlencoded", target: "top", targetSource: "form", targetOverride: "absent", methodOverride: "absent", ownerMatches: true } });
  });
  await expect.poll(() => trace.currentEvents().filter(e => e.kind === "form.intent").length).toBe(2);
  const [input, borrowed] = trace.currentEvents().filter(e => e.kind === "form.intent");
  // A donor-realm label is accurate, but cannot be promoted to an initiator proof.
  expect(input!.binding).toEqual(borrowed!.binding);
}));
