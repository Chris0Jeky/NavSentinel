/** Dedicated synthetic-page CDP channel; no extension debugger permission is used. */
import type { Page } from "@playwright/test";
import { FormDocumentRegistry } from "./form_document_registry";
import type { FormObservation } from "./form_observatory";
const bindingName = "__nsFormDocumentWire";
export async function attachFormDocumentObserver(page: Page, trace: FormObservation, origin: string) {
  const session = await page.context().newCDPSession(page);
  const registry = new FormDocumentRegistry({ origin, started: b => trace.documentStarted(b), ended: (b, reason) => trace.documentEnded(b, reason), rejected: code => trace.fail(code) });
  let closed = false, plannedClose = false, scriptId: string | undefined;
  const navigated = ({ frame }: { frame: { id: string; parentId?: string; loaderId: string } }) => registry.frameNavigated(frame);
  const created = ({ context }: { context: { id: number; uniqueId: string; origin: string; auxData?: unknown } }) => registry.contextCreated(context);
  const destroyed = ({ executionContextId }: { executionContextId: number }) => registry.contextDestroyed(executionContextId);
  const cleared = () => registry.contextsCleared();
  const detached = ({ frameId }: { frameId: string }) => registry.frameDetached(frameId);
  const lost = () => { if (!closed && !plannedClose) trace.fail("DOCUMENT_TRANSPORT_LOST"); registry.close(); };
  const receive = (event: { name: string; executionContextId: number; payload: string }) => {
    if (closed || event.name !== bindingName) return;
    const binding = registry.resolve(event.executionContextId); if (!binding) return;
    if (typeof event.payload !== "string" || Buffer.byteLength(event.payload, "utf8") > 4096) { trace.fail("PROBE_REJECTED"); return; }
    let value: unknown; try { value = JSON.parse(event.payload); } catch { trace.fail("PROBE_REJECTED"); return; }
    trace.pageReport(value, binding);
  };
  session.on("Page.frameNavigated", navigated); session.on("Page.frameDetached", detached);
  session.on("Runtime.executionContextCreated", created); session.on("Runtime.executionContextDestroyed", destroyed);
  session.on("Runtime.executionContextsCleared", cleared); session.on("Runtime.bindingCalled", receive);
  session.on("Inspector.detached", lost); page.on("close", lost);
  async function dispose() {
    if (closed) return; closed = true; registry.close();
    session.off("Page.frameNavigated", navigated); session.off("Page.frameDetached", detached);
    session.off("Runtime.executionContextCreated", created); session.off("Runtime.executionContextDestroyed", destroyed);
    session.off("Runtime.executionContextsCleared", cleared); session.off("Runtime.bindingCalled", receive);
    session.off("Inspector.detached", lost); page.off("close", lost);
    try {
      if (scriptId) await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
      await session.send("Runtime.removeBinding", { name: bindingName });
    } catch { if (!plannedClose && !page.isClosed()) trace.fail("DOCUMENT_TRANSPORT_LOST"); }
    try { await session.detach(); } catch { if (!plannedClose && !page.isClosed()) trace.fail("DOCUMENT_TRANSPORT_LOST"); }
  }
  try {
    await session.send("Page.enable");
    const { frameTree } = await session.send("Page.getFrameTree");
    const visit = (tree: typeof frameTree) => { registry.frameNavigated(tree.frame); for (const child of tree.childFrames ?? []) visit(child); };
    visit(frameTree);
    await session.send("Runtime.addBinding", { name: bindingName });
    await session.send("Runtime.enable");
    // Fixed wrapper preserves the existing fixture probe API. MAIN may forge
    // these payloads, but cannot supply Runtime.bindingCalled's context ID.
    const source = `if(location.origin===${JSON.stringify(origin)}){const send=globalThis.${bindingName};globalThis.__nsFormObservation=value=>send(JSON.stringify(value));}`;
    scriptId = (await session.send("Page.addScriptToEvaluateOnNewDocument", { source })).identifier;
    return { prepareToClose: () => { plannedClose = true; }, dispose };
  } catch (error) {
    trace.fail("DOCUMENT_TRANSPORT_LOST"); await dispose(); throw error;
  }
}
