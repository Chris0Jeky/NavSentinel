/** Validate imported reporting-realm lifetimes; never infer the native initiator. */
export const FORM_DOCUMENT_SCHEMA = 'navsentinel.observatory.form.v2';
export const DOCUMENT_POLICY = 'CDP_DEFAULT_WORLD_DOCUMENT';
const ends = ['navigation','context-destroyed','contexts-cleared','frame-detached','collector-closed','context-replaced'];
const fail = () => { throw new Error('FORM_DOCUMENT_LIFETIME_INVALID'); };
function binding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'documentId,frameId,scope' ||
      typeof value.frameId !== 'string' || typeof value.documentId !== 'string' ||
      !/^frame-[1-9][0-9]{0,2}$/.test(value.frameId) || !/^document-[1-9][0-9]{0,2}$/.test(value.documentId) || !['top','child'].includes(value.scope)) fail();
  return { ...value };
}
export function documentLifetimes() {
  const documents = [], seen = new Set(), active = new Map(), frames = new Map(), frameScopes = new Map();
  return {
    observe(e, eventIndex) {
      const needed = ['document.started','document.ended','form.intent'].includes(e.kind);
      if (!needed) { if (Object.hasOwn(e,'binding')) fail(); return null; }
      const b = binding(e.binding);
      if (e.kind === 'document.started') {
        if (e.source !== 'browser' || seen.has(b.documentId) || frames.has(b.frameId) || documents.length >= 256) fail();
        if (frameScopes.has(b.frameId) && frameScopes.get(b.frameId) !== b.scope) fail();
        const row = { ...b, startEventId:e.id, startIndex:eventIndex, endEventId:null, endIndex:null, endReason:null };
        frameScopes.set(b.frameId,b.scope); seen.add(b.documentId); active.set(b.documentId,row); frames.set(b.frameId,b.documentId); documents.push(row);
      } else {
        const row = active.get(b.documentId);
        if (!row || row.frameId !== b.frameId || row.scope !== b.scope) fail();
        if (e.kind === 'document.ended') {
          if (e.source !== 'browser' || !ends.includes(e.data.reason)) fail();
          row.endEventId=e.id;row.endIndex=eventIndex;row.endReason=e.data.reason;active.delete(b.documentId);frames.delete(b.frameId);
        }
      }
      return b;
    },
    result() { return { documents:structuredClone(documents), incomplete:active.size > 0 }; },
  };
}
