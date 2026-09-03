import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CorpusReplayHarness,
  CorpusReplayInvalid,
  exerciseFirstEligibleControl,
} from "./corpus_replay_harness";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");

const ATTACK_SOURCE_URL = "https://attack.corpus-contract.test/login";
const ATTACK_RECEIPT_URL =
  "https://credential-receipt.attack-contract.test/received";
const BENIGN_SOURCE_URL = "https://benign.corpus-contract.test/home";
const BENIGN_RECEIPT_URL = "https://benign.corpus-contract.test/visited";
const GET_FORM_SOURCE_URL = "https://form-get.corpus-contract.test/login";
const GET_FORM_RECEIPT_URL = "https://form-get.corpus-contract.test/received";
const POST_FORM_SOURCE_URL = "https://form-post.corpus-contract.test/login";
const POST_FORM_RECEIPT_URL =
  "https://form-post.corpus-contract.test/received";
const MIXED_SOURCE_URL = "https://mixed.corpus-contract.test/choices";
const MIXED_RECEIPT_URL = "https://mixed.corpus-contract.test/visited";

function sourceBytes(marker: string, body: string): Buffer {
  return Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="navsentinel-fixture" content="${marker}">
<title>Inert corpus methodology fixture</title></head><body>${body}</body></html>`);
}

function registrableTestSite(url: string): string {
  return new URL(url).hostname.split(".").slice(-2).join(".");
}

async function startHarness(): Promise<CorpusReplayHarness> {
  if (!fs.existsSync(extensionPath)) {
    throw new CorpusReplayInvalid("extension_build_missing");
  }
  return CorpusReplayHarness.start(extensionPath);
}

async function credentialModalVisible(page: Page): Promise<boolean> {
  return page
    .locator("#__sentinelsuite_cred_modal_host__ .overlay")
    .isVisible()
    .catch(() => false);
}

test.beforeAll(() => {
  expect(registrableTestSite(ATTACK_SOURCE_URL)).not.toBe(
    registrableTestSite(ATTACK_RECEIPT_URL),
  );
  expect(new URL(BENIGN_SOURCE_URL).origin).toBe(
    new URL(BENIGN_RECEIPT_URL).origin,
  );
  expect(new URL(GET_FORM_SOURCE_URL).origin).toBe(
    new URL(GET_FORM_RECEIPT_URL).origin,
  );
  expect(new URL(POST_FORM_SOURCE_URL).origin).toBe(
    new URL(POST_FORM_RECEIPT_URL).origin,
  );
  expect(new URL(MIXED_SOURCE_URL).origin).toBe(
    new URL(MIXED_RECEIPT_URL).origin,
  );
});

test("shared corpus replay uses exact reserved URLs and trusted native input @corpus-contract @regression", async () => {
  const harness = await startHarness();
  try {
    const page = await harness.open({
      url: BENIGN_SOURCE_URL,
      bytes: sourceBytes(
        "benign-source",
        `<script>window.__corpusScriptRan = true;</script>
         <a href="${BENIGN_RECEIPT_URL}">Continue to inert receipt</a>`,
      ),
    });
    expect(harness.routeHits.get(BENIGN_SOURCE_URL)).toBe(1);
    await expect(
      page.locator('meta[name="navsentinel-fixture"]'),
    ).toHaveAttribute("content", "benign-source");
    expect(
      await page.evaluate(
        () =>
          (window as unknown as Record<string, unknown>).__corpusScriptRan ??
          null,
      ),
    ).toBeNull();

    const exercise = await exerciseFirstEligibleControl(harness, page);
    expect(exercise.kind).toBe("link");
    if (exercise.receiptBefore === null) {
      throw new CorpusReplayInvalid("input_unavailable");
    }
    const harmReached = await harness.awaitTerminal(
      exercise.receiptBefore,
      async () => false,
    );
    expect(harmReached).toBe(true);
    expect(harness.receipts).toEqual([
      { url: BENIGN_RECEIPT_URL, method: "GET" },
    ]);
    harness.throwIfInvalid();
  } finally {
    await harness.close();
  }
});

test("shared corpus replay records no harm receipt when credential submission is protected @corpus-contract @regression", async () => {
  const harness = await startHarness();
  try {
    const page = await harness.open({
      url: ATTACK_SOURCE_URL,
      bytes: sourceBytes(
        "attack-source",
        `<form action="${ATTACK_RECEIPT_URL}" method="post">
           <label>Email <input name="email" type="email" required></label>
           <label>Password <input name="password" type="password" required></label>
           <button type="submit">Continue</button>
         </form>`,
      ),
    });
    const exercise = await exerciseFirstEligibleControl(harness, page);
    expect(exercise.kind).toBe("form");
    expect(exercise.getQueryPathBound).toBe(false);
    if (exercise.receiptBefore === null) {
      throw new CorpusReplayInvalid("input_unavailable");
    }
    const harmReached = await harness.awaitTerminal(
      exercise.receiptBefore,
      () => credentialModalVisible(page),
    );
    expect(harmReached).toBe(false);
    await expect(
      page.locator("#__sentinelsuite_cred_modal_host__ .overlay"),
    ).toBeVisible();
    expect(harness.receipts).toEqual([]);
    harness.throwIfInvalid();
  } finally {
    await harness.close();
  }
});

test("corpus receipt routing contains a browser-generated GET query by action path @corpus-contract @regression", async () => {
  const harness = await startHarness();
  try {
    const page = await harness.open({
      url: GET_FORM_SOURCE_URL,
      bytes: sourceBytes(
        "get-form-source",
        `<form action="${GET_FORM_RECEIPT_URL}" method="get">
           <label>Email <input name="email" type="email" required></label>
           <button type="submit">Continue</button>
         </form>`,
      ),
    });
    const form = page.locator("form");
    const email = page.locator('input[type="email"]');
    const submitter = page.locator('button[type="submit"]');
    await email.fill("fixture@example.test");
    const receiptBefore = harness.armReceipt(
      page,
      GET_FORM_RECEIPT_URL,
      "GET",
      { getPathOnly: true },
    );
    await harness.activate(
      page,
      [
        { type: "pointerdown", target: submitter },
        { type: "click", target: submitter },
        { type: "submit", target: form },
      ],
      () => submitter.click(),
    );
    expect(
      await harness.awaitTerminal(receiptBefore, async () => false),
    ).toBe(true);
    expect(harness.receipts).toHaveLength(1);
    const receipt = harness.receipts[0];
    expect(receipt?.method).toBe("GET");
    const receiptUrl = new URL(receipt?.url ?? "");
    expect(`${receiptUrl.origin}${receiptUrl.pathname}`).toBe(
      GET_FORM_RECEIPT_URL,
    );
    expect(receiptUrl.searchParams.get("email")).toBe("fixture@example.test");
    harness.throwIfInvalid();
  } finally {
    await harness.close();
  }
});

test("corpus receipt routing records an unprotected POST as harm @corpus-contract @regression", async () => {
  const harness = await startHarness();
  try {
    const page = await harness.open({
      url: POST_FORM_SOURCE_URL,
      bytes: sourceBytes(
        "post-form-source",
        `<form action="${POST_FORM_RECEIPT_URL}" method="post">
           <label>Email <input name="email" type="email" required></label>
           <button type="submit">Continue</button>
         </form>`,
      ),
    });
    const form = page.locator("form");
    const email = page.locator('input[type="email"]');
    const submitter = page.locator('button[type="submit"]');
    await email.fill("fixture@example.test");
    const receiptBefore = harness.armReceipt(
      page,
      POST_FORM_RECEIPT_URL,
      "POST",
    );
    await harness.activate(
      page,
      [
        { type: "pointerdown", target: submitter },
        { type: "click", target: submitter },
        { type: "submit", target: form },
      ],
      () => submitter.click(),
    );
    expect(
      await harness.awaitTerminal(receiptBefore, async () => false),
    ).toBe(true);
    expect(harness.receipts).toEqual([
      { url: POST_FORM_RECEIPT_URL, method: "POST" },
    ]);
    harness.throwIfInvalid();
  } finally {
    await harness.close();
  }
});

test("shared corpus replay skips a dormant attack control and contains one armed popup receipt @corpus-contract @regression", async () => {
  const harness = await startHarness();
  try {
    const page = await harness.open({
      url: MIXED_SOURCE_URL,
      bytes: sourceBytes(
        "mixed-source",
        `<form hidden action="${ATTACK_RECEIPT_URL}" method="post">
           <input type="password"><button type="submit">Do not select</button>
         </form>
         <a target="_blank" rel="opener" href="${MIXED_RECEIPT_URL}">Open selected receipt</a>`,
      ),
    });
    const exercise = await exerciseFirstEligibleControl(harness, page);
    expect(exercise.kind).toBe("link");
    if (exercise.receiptBefore === null) {
      throw new CorpusReplayInvalid("input_unavailable");
    }
    const harmReached = await harness.awaitTerminal(
      exercise.receiptBefore,
      async () => false,
    );
    expect(harmReached).toBe(true);
    expect(harness.receipts).toEqual([
      { url: MIXED_RECEIPT_URL, method: "GET" },
    ]);
    harness.throwIfInvalid();
  } finally {
    await harness.close();
  }
});

test("shared corpus replay latches unarmed trusted navigation as TEST_INVALID @corpus-contract @regression", async () => {
  const harness = await startHarness();
  try {
    const page = await harness.open({
      url: BENIGN_SOURCE_URL,
      bytes: sourceBytes(
        "unarmed-source",
        `<a href="${BENIGN_RECEIPT_URL}">Unarmed navigation</a>`,
      ),
    });
    await page.locator("a").click().catch(() => {});
    expect(() => harness.throwIfInvalid()).toThrow(
      "TEST_INVALID:unexpected_page_request",
    );
    expect(harness.receipts).toEqual([]);
  } finally {
    await harness.close();
  }
});
