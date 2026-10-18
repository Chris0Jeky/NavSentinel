import assert from "node:assert/strict";
import type { Page } from "@playwright/test";

// Fixed synthetic fixture code, not a product injection or permission grant.
// Preserve native close from the trusted handler, but let its click command
// finish first. Otherwise target disposal can reject the very command that
// successfully closed the child. No click error is swallowed or retried.
export const FIXTURE_CLOSE_SCRIPT = `
document.querySelector('#close').addEventListener('click', async event => {
  if (!event.isTrusted) return;
  await window.__nsFixtureCloseReady();
  window.close();
});
`;

export async function prepareFixtureClose(page: Page) {
  let requests = 0;
  let released = false;
  let grant!: () => void;
  const permission = new Promise<void>((resolve) => { grant = resolve; });
  await page.exposeBinding("__nsFixtureCloseReady", async (source) => {
    assert.equal(source.page, page, "close receipt must come from the expected child");
    assert.equal(source.frame, page.mainFrame(), "close receipt must come from its top document");
    requests++;
    assert.equal(requests, 1, "only one close activation is expected");
    await permission;
  });
  return {
    get requests() { return requests; },
    release() {
      assert.equal(requests, 1, "release requires one trusted fixture activation");
      assert.equal(released, false, "close permission is one-use");
      assert.equal(page.isClosed(), false, "the child must survive until the click is acknowledged");
      released = true;
      grant();
    },
  };
}
