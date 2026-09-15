import { formNavigationDeadline, FORM_INTENT_TTL_MS, isFormIntent, isHttpFormIntent } from "../shared/form_intent";
import { swState } from "../shared/session_state";

/** Static MV3 module. Caller serializes this handler behind session hydration. */
export function handleChildFormMessage(
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  rememberUserNavigationContext: (tabId: number, now: number) => void,
): boolean {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  const documentId = sender.documentId;
  // Chrome-owned sender identity, not MAIN/page-supplied frame fields.
  if (sender.id !== chrome.runtime.id || typeof tabId !== "number" ||
      !Number.isSafeInteger(frameId) || !frameId || frameId < 0 ||
      typeof documentId !== "string" || !documentId || documentId.length > 128) {
    return false;
  }
  const current = swState.formNavigationByTab.get(tabId);
  if (message.type === "ns-form-intent-cancel") {
    if (current && current.attemptId === message.attemptId && current.sourceFrameId === frameId && current.sourceDocumentId === documentId) {
      current.phase = "spent";
      delete current.startedUrl;
      swState.persistMap(swState.formNavigationByTab, "formNavigation");
    }
    return true;
  }
  const now = Date.now();
  const issuedAt = message.issuedAt;
  if (typeof message.attemptId !== "string" || !/^[a-f0-9]{32}$/.test(message.attemptId) ||
      current?.attemptId === message.attemptId || !isFormIntent(message.formIntent) || !isHttpFormIntent(message.formIntent) ||
      typeof issuedAt !== "number" || !Number.isFinite(issuedAt) || issuedAt > now || now >= issuedAt + FORM_INTENT_TTL_MS) {
    return false;
  }
  for (const [id, entry] of swState.formNavigationByTab) if (formNavigationDeadline(entry) <= now) swState.formNavigationByTab.delete(id);
  if (swState.formNavigationByTab.size >= 256 && !swState.formNavigationByTab.has(tabId)) {
    return false;
  }
  swState.formNavigationByTab.set(tabId, {
    attemptId: message.attemptId, sourceFrameId: frameId, sourceDocumentId: documentId,
    intent: message.formIntent, issuedAt, expiresAt: issuedAt + FORM_INTENT_TTL_MS, phase: "armed",
  });
  // A form click revokes, rather than widens, previous generic windows.
  swState.allowUntilByTab.delete(tabId);
  swState.gestureUntilByTab.delete(tabId);
  swState.allowStartedByTab.delete(tabId);
  swState.allowTargetByTab.delete(tabId);
  swState.typedOriginByTab.delete(tabId);
  rememberUserNavigationContext(tabId, now);
  const topUrl = sender.tab?.url;
  if (typeof topUrl === "string" && topUrl) swState.lastUrlByTab.set(tabId, topUrl);
  swState.persistAll();
  return true;
}
