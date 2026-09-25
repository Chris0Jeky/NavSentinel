/** Test-runner identity map. Only CDP metadata, never a page-supplied ID, enters here. */
export interface DocumentBinding { frameId: string; documentId: string; scope: "top" | "child" }
export type DocumentEndReason = "navigation" | "context-destroyed" | "contexts-cleared" | "frame-detached" | "collector-closed" | "context-replaced";
interface FrameEntry { token: string; parent: string | null; loader: string }
interface ContextEntry { unique: string; frame: string; binding: DocumentBinding }
interface Options {
  origin: string; maxDocuments?: number;
  started: (binding: DocumentBinding) => void;
  ended: (binding: DocumentBinding, reason: DocumentEndReason) => void;
  rejected: (code: string) => void;
}
export class FormDocumentRegistry {
  private readonly frames = new Map<string, FrameEntry>();
  private readonly contexts = new Map<number, ContextEntry>();
  private readonly seenContexts = new Set<number>();
  private readonly seenRealms = new Set<string>();
  private frameCount = 0;
  private documentCount = 0;
  private closed = false;
  private readonly maxDocuments: number;
  constructor(private readonly options: Options) {
    const url = new URL(options.origin);
    if (url.origin !== options.origin || url.protocol !== "http:" || url.hostname !== "localhost" || !url.port) throw new Error("DOCUMENT_ORIGIN_INVALID");
    this.maxDocuments = options.maxDocuments ?? 64;
    if (!Number.isInteger(this.maxDocuments) || this.maxDocuments < 1 || this.maxDocuments > 256) throw new Error("DOCUMENT_LIMIT_INVALID");
  }
  private reject(code: string): null { if (!this.closed) this.options.rejected(code); return null; }
  private retire(id: number, reason: DocumentEndReason): void {
    const entry = this.contexts.get(id); if (!entry) return;
    this.contexts.delete(id); this.options.ended({ ...entry.binding }, reason);
  }
  private subtree(frame: string): Set<string> {
    const ids = new Set([frame]);
    for (let i = 0; i < this.frames.size; i++) {
      let added = false;
      for (const [id, entry] of this.frames) if (entry.parent && ids.has(entry.parent) && !ids.has(id)) { ids.add(id); added = true; }
      if (!added) break;
    }
    return ids;
  }
  private retireTree(frame: string, reason: DocumentEndReason): void {
    const ids = this.subtree(frame);
    for (const [id, entry] of this.contexts) if (ids.has(entry.frame)) this.retire(id, reason);
  }
  frameNavigated(frame: { id: string; parentId?: string; loaderId: string }): void {
    if (this.closed) return;
    if (!frame.id || !frame.loaderId || frame.id.length > 256 || frame.loaderId.length > 256) { this.reject("DOCUMENT_METADATA_INVALID"); return; }
    const current = this.frames.get(frame.id), parent = frame.parentId ?? null;
    if (current) {
      if (current.loader !== frame.loaderId || current.parent !== parent) this.retireTree(frame.id, "navigation");
      current.loader = frame.loaderId; current.parent = parent;
    } else if (this.frameCount < 64) {
      this.frames.set(frame.id, { token: `frame-${++this.frameCount}`, parent, loader: frame.loaderId });
    } else this.reject("DOCUMENT_LIMIT");
  }
  contextCreated(context: { id: number; uniqueId: string; origin: string; auxData?: unknown }): void {
    if (this.closed) return;
    const aux = context.auxData as { isDefault?: unknown; frameId?: unknown } | undefined;
    if (aux?.isDefault !== true || context.origin !== this.options.origin) return;
    if (!Number.isSafeInteger(context.id) || context.id < 1 || !context.uniqueId || context.uniqueId.length > 256 || typeof aux.frameId !== "string") { this.reject("DOCUMENT_METADATA_INVALID"); return; }
    const current = this.contexts.get(context.id);
    if (current?.unique === context.uniqueId && current.frame === aux.frameId) return;
    if (this.seenContexts.has(context.id) || this.seenRealms.has(context.uniqueId)) {
      this.retire(context.id, "context-replaced"); this.reject("DOCUMENT_CONTEXT_REUSED"); return;
    }
    const frame = this.frames.get(aux.frameId);
    if (!frame) { this.reject("DOCUMENT_FRAME_UNKNOWN"); return; }
    if (this.documentCount >= this.maxDocuments) { this.reject("DOCUMENT_LIMIT"); return; }
    // Only one default realm may be active for a frame. Replacement must not
    // leave the old context usable even when destruction delivery arrives later.
    for (const [id, entry] of this.contexts) if (entry.frame === aux.frameId) this.retire(id, "context-replaced");
    const binding: DocumentBinding = { frameId: frame.token, documentId: `document-${++this.documentCount}`, scope: frame.parent === null ? "top" : "child" };
    this.seenContexts.add(context.id); this.seenRealms.add(context.uniqueId);
    this.contexts.set(context.id, { unique: context.uniqueId, frame: aux.frameId, binding });
    this.options.started({ ...binding });
  }
  resolve(contextId: number): DocumentBinding | null {
    if (this.closed) return null;
    const entry = this.contexts.get(contextId);
    return entry ? { ...entry.binding } : this.reject("DOCUMENT_CONTEXT_UNKNOWN");
  }
  contextDestroyed(id: number): void { if (!this.closed) this.retire(id, "context-destroyed"); }
  contextsCleared(): void { if (!this.closed) for (const id of this.contexts.keys()) this.retire(id, "contexts-cleared"); }
  frameDetached(frame: string): void {
    if (this.closed) return;
    this.retireTree(frame, "frame-detached");
    for (const id of this.subtree(frame)) this.frames.delete(id);
  }
  close(): void {
    if (this.closed) return;
    for (const id of this.contexts.keys()) this.retire(id, "collector-closed");
    this.closed = true; this.frames.clear(); this.seenContexts.clear(); this.seenRealms.clear();
  }
}
