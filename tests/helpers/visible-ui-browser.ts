import type { Locator } from "@playwright/test";
import { DBLCLICK_WINDOW_MS } from "../../extension/src/shared/doubleclick_timing";

/** Allow the entrance animation and the continuous visible exposure window. */
export async function waitForVisibleAction(control: Locator): Promise<void> {
  await control.waitFor({ state: "visible" });
  await control.page().waitForTimeout(DBLCLICK_WINDOW_MS + 300);
}
