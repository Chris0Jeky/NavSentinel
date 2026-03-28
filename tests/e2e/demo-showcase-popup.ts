import { expect, type BrowserContext, type Worker } from "@playwright/test";
import type {
  PopupSnapshot,
  PopupTestClickTarget,
  PopupTestMessage,
  PopupTestResponse,
  PopupTestSelectTarget
} from "../../extension/src/shared/popup_test";
import { getServiceWorker } from "./extension_test_utils";

export async function openRealPopup(context: BrowserContext): Promise<void> {
  const worker = await getServiceWorker(context);
  await ensurePopupContext(context, worker);
}

export async function getPopupSnapshot(context: BrowserContext): Promise<PopupSnapshot> {
  const response = await sendPopupAction(context, { type: "ns_popup_test", action: "snapshot" });
  if (!response.snapshot) {
    throw new Error("Popup snapshot missing");
  }
  return response.snapshot;
}

export async function clickPopupTarget(
  context: BrowserContext,
  target: PopupTestClickTarget
): Promise<PopupSnapshot> {
  const response = await sendPopupAction(context, { type: "ns_popup_test", action: "click", target });
  if (!response.snapshot) {
    throw new Error("Popup snapshot missing after click");
  }
  return response.snapshot;
}

export async function selectPopupMode(
  context: BrowserContext,
  target: PopupTestSelectTarget,
  value: string
): Promise<PopupSnapshot> {
  const response = await sendPopupAction(context, {
    type: "ns_popup_test",
    action: "select",
    target,
    value
  });
  if (!response.snapshot) {
    throw new Error("Popup snapshot missing after select");
  }
  return response.snapshot;
}

async function sendPopupAction(
  context: BrowserContext,
  action: PopupTestMessage
): Promise<PopupTestResponse> {
  const worker = await getServiceWorker(context);
  await ensurePopupContext(context, worker);

  const response = await worker.evaluate(async (message) => {
    return (await chrome.runtime.sendMessage(message)) as PopupTestResponse;
  }, action);

  if (!response?.ok) {
    throw new Error(response?.error || "Popup test action failed");
  }
  return response;
}

async function ensurePopupContext(context: BrowserContext, worker?: Worker): Promise<void> {
  const activeWorker = worker ?? (await getServiceWorker(context));
  const isOpen = await isPopupContextOpen(activeWorker);
  if (!isOpen) {
    await activeWorker.evaluate(async () => {
      await chrome.action.openPopup();
      return true;
    });
  }
  await expect
    .poll(async () => isPopupContextOpen(activeWorker), { timeout: 5000 })
    .toBe(true);
}

async function isPopupContextOpen(worker: Worker): Promise<boolean> {
  return worker.evaluate(async () => {
    const contexts = await (chrome.runtime.getContexts as unknown as (filter: unknown) => Promise<unknown[]>)({
      contextTypes: ["POPUP"]
    });
    return Array.isArray(contexts) && contexts.length > 0;
  });
}
