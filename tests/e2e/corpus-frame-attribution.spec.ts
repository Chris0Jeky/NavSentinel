import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CorpusReplayHarness, CorpusReplayInvalid } from "./corpus_replay_harness";

const extensionPath = process.env.EXTENSION_PATH ?? path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../../extension/dist",
);
const sourceUrl = "https://frame.corpus-contract.test/source";
const receiptUrl = "https://frame.corpus-contract.test/receipt";

async function startFrameFixture() {
  const harness = await CorpusReplayHarness.start(extensionPath);
  try {
    const page = await harness.open({
      url: sourceUrl,
      bytes: Buffer.from(`<!doctype html><html><head></head><body>
        <button id="top">Top</button>
        <iframe srcdoc="<!doctype html><html><head></head><body><button id=child>Child</button></body></html>"></iframe>
      </body></html>`),
    });
    const child = page.frameLocator("iframe").locator("#child");
    await expect(child).toBeVisible();
    harness.armReceipt(page, receiptUrl, "GET");
    return { harness, page, child };
  } catch (error) {
    await harness.close();
    throw error;
  }
}

test("corpus replay rejects child input attributed to an identical top-document path @corpus-contract @regression", async () => {
  const { harness, page, child } = await startFrameFixture();
  try {
    const top = page.locator("#top");
    const outcome = await harness.activate(page, [
      { type: "pointerdown", target: top },
      { type: "click", target: top },
    ], () => child.click()).then(() => "accepted", (error: unknown) => {
      if (error instanceof CorpusReplayInvalid) return error.code;
      throw error;
    });
    expect(outcome).toBe("trusted_activation_missing");
  } finally {
    await harness.close();
  }
});

test("corpus replay accepts trusted input attributed to its actual child document @corpus-contract @regression", async () => {
  const { harness, page, child } = await startFrameFixture();
  try {
    await harness.activate(page, [
      { type: "pointerdown", target: child },
      { type: "click", target: child },
    ], () => child.click());
    harness.throwIfInvalid();
  } finally {
    await harness.close();
  }
});
