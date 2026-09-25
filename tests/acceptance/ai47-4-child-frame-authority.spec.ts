/**
 * AI-47 step 4 — child-frame navigation authority in the real branded Chrome.
 *   (a) PR #636 / former AI-41: docs/agentic/GATE3_GUIDES.md "Retained guide:
 *       AI-41" steps 1-6 and 8 (step 7, live third-party sites, is run
 *       separately by the coordinator).
 *   (b) PR #649 / former AI-46: docs/agentic/AI-46-issue637-child-form-target.md
 *       step 5 plus the step-4 attack arms, driven in this profile.
 * The fixture is the tracked #593 model (`gym/investigation-593-*.html`) served
 * on `localhost`; its only consequence is a typed receipt on the loopback fake
 * sink at `127.0.0.1:461xx`, so every hop is genuinely cross-site. Automated
 * agent evidence, never the owner Gate-3 result.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { AcceptanceSession, SETTINGS_KEY, installBfcacheProbe, lastPageshowPersisted, repoRoot, trustedClick } from "./acceptance_harness";
import { startProvingGroundFakeSink, type ProvingGroundFakeSink, type ProvingGroundRole } from "../e2e/proving_ground_fake_sink";
import { clickToastButton, installPageInputCounter, toastCards } from "./page_ui_helpers";

const PR_636_MERGE = "d91d11f546a925cfc45f721856e1c8b0378ff23d";
const PR_649_MERGE = "c78ba99da5d3357833a5fcd3f4f09bdb255db7a6";
const SCENARIO_ID = "issue-593-hidden-media-layer-modelled";
const CONSEQUENCE = "modelled-hidden-media-navigation";
/** Guide step 3: wait at least six seconds after load before clicking. */
const TYPED_ORIGIN_SETTLE_MS = 6_500;
const OBSERVATION_MS = 3_500;
const SINK_PATH = "/__navsentinel_fake_sink";
const CONSOLE_NOISE = [/favicon\.ico/, /Synthetic sink rejected/];

type Arm = {
  id: string;
  primitive: string;
  delayMs: number;
  input: "physical-click" | "keyboard" | "top-physical-click";
  layer: "hidden" | "visible";
  role: ProvingGroundRole;
};

type Armed = { page: Page; frame: Frame; sink: ProvingGroundFakeSink; fixtureUrl: string; diagnostics: Array<Record<string, unknown>> };

const sinks: ProvingGroundFakeSink[] = [];

async function armFixture(session: AcceptanceSession, arm: Arm): Promise<Armed> {
  const sink = await startProvingGroundFakeSink({
    runId: `${SCENARIO_ID}-${arm.id}`,
    scenarioId: SCENARIO_ID,
    allowedRoles: [arm.role],
    allowedConsequences: [CONSEQUENCE],
    targetAuthorities: [{ id: `protected-${arm.id}`, role: arm.role, consequence: CONSEQUENCE, maxUses: 3 }],
  });
  sinks.push(sink);
  const fixture = new URL(session.url("/investigation-593-hidden-media-layer.html", "localhost"));
  fixture.searchParams.set("arm", arm.id);
  fixture.searchParams.set("primitive", arm.primitive);
  fixture.searchParams.set("delay", String(arm.delayMs));
  fixture.searchParams.set("layer", arm.layer);
  fixture.searchParams.set("input", arm.input);
  fixture.searchParams.set("role", arm.role);
  fixture.searchParams.set("sink", sink.urlFor(arm.role, CONSEQUENCE, `protected-${arm.id}`));
  const page = await session.newPage();
  for (const stale of session.context.pages()) {
    if (stale !== page && (stale.url().includes("investigation-593") || stale.url().includes(SINK_PATH))) await stale.close().catch(() => undefined);
  }
  const diagnostics: Array<Record<string, unknown>> = [];
  page.on("console", (message) => {
    const text = message.text();
    if (!text.startsWith("NAVSENTINEL_ISSUE593:")) return;
    try { diagnostics.push(JSON.parse(text.slice("NAVSENTINEL_ISSUE593:".length)) as Record<string, unknown>); } catch { /* ignore */ }
  });
  const markers = await session.gotoReady(page, fixture.href);
  expect(markers).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
  await installBfcacheProbe(page);
  const frame = await childFrame(session, page);
  // The parent always arms the sink; the child only for arms it drives (top-frame arms are parent-only).
  const readyPhases = arm.input === "top-physical-click" ? ["parent-ready"] : ["parent-ready", "child-ready"];
  for (const phase of readyPhases) {
    await expect.poll(() => diagnostics.some((entry) => entry.phase === phase && entry.sinkArmed === true),
      { timeout: 5000, message: `the fixture (${phase}) accepted the armed loopback sink` }).toBe(true);
  }
  expect(sink.snapshot().receipts.length).toBe(0);
  return { page, frame, sink, fixtureUrl: fixture.href, diagnostics };
}

async function childFrame(session: AcceptanceSession, page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((frame) => frame.url().includes("/investigation-593-hidden-media-child.html")), { timeout: 10_000 }).toBe(true);
  const frame = page.frames().find((candidate) => candidate.url().includes("/investigation-593-hidden-media-child.html"))!;
  await frame.waitForFunction((guard) => document.documentElement.dataset.fixtureReady === "1" &&
    document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-ui-guard") === guard, session.guardRevision, { timeout: 15_000 });
  return frame;
}

function armedEntry(armed: Armed, frame: "child" | "parent"): Record<string, unknown> | undefined {
  return armed.diagnostics.find((entry) => entry.phase === "armed" && ((entry.frameOverride as string | undefined) ?? entry.frame) === frame);
}

function onSink(page: Page): boolean {
  return page.url().includes(SINK_PATH);
}

function onFixture(armed: Armed): boolean {
  return armed.page.url().split("#")[0] === armed.fixtureUrl.split("#")[0];
}

/** The player centre, where the nearly transparent same-origin frame covers the visible media. */
async function clickVisiblePlayer(armed: Armed): Promise<void> {
  const box = await armed.page.locator("#player-poster").boundingBox();
  await armed.page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function expectBenignNavigationStays(armed: Armed, label: string): Promise<void> {
  await expect.poll(() => armed.sink.snapshot().receipts.length, { timeout: 10_000, message: `${label}: destination request` }).toBe(1);
  await expect.poll(() => onSink(armed.page), { timeout: 8000, message: `${label}: destination loads` }).toBe(true);
  await armed.page.waitForTimeout(OBSERVATION_MS);
  expect(onSink(armed.page), `${label}: the tab stays on the destination (no rollback)`).toBe(true);
  expect(armed.sink.snapshot().receipts.length, `${label}: exactly one destination request`).toBe(1);
}

async function expectRolledBackWithProceed(armed: Armed): Promise<string> {
  await expect.poll(() => armed.sink.snapshot().receipts.length, { timeout: 10_000, message: "the deceptive request is issued" }).toBe(1);
  await expect.poll(() => onFixture(armed) ? "fixture" : armed.page.url().split("?")[0], { timeout: 10_000, message: "tab returns to the source page" }).toBe("fixture");
  await expect.poll(async () => (await toastCards(armed.page)).map((card) => card.text).join(" | "), { timeout: 6000 })
    .toMatch(/rolled back a suspicious redirect/i);
  const card = (await toastCards(armed.page)).find((candidate) => /rolled back/i.test(candidate.text))!;
  expect(card.buttons).toContain("Proceed");
  await armed.page.waitForTimeout(1500);
  expect(onFixture(armed), "the tab does not silently settle on the destination").toBe(true);
  return card.text;
}

function requireHead(session: AcceptanceSession, merge: string, pr: string): Promise<void | undefined> {
  return session.step(`1. tested head contains the ${pr} merge and has no product-source changes`, async () => {
    execFileSync("git", ["merge-base", "--is-ancestor", merge, "HEAD"], { cwd: repoRoot });
    expect(session.receipt.git.productSourceClean).toBe(true);
    session.note(`tested head ${session.receipt.git.head}; ui-guard ${session.guardRevision}; Chrome ${session.chromeVersion}`);
  });
}

async function smartAndNotTrusted(session: AcceptanceSession): Promise<void> {
  await session.patchNavigation({ defaultMode: "smart", autoDismissOverlays: false });
  const all = await session.worker.evaluate(async () => chrome.storage.local.get(null));
  const settings = all[SETTINGS_KEY] as { nav?: { defaultMode?: string } } | undefined;
  const allowAndTrust = JSON.stringify({ allow: all["sentinelsuite:nav_allowlist_v1"] ?? null, trusted: all["sentinelsuite:trusted_domains_v1"] ?? null });
  session.note(`navigation mode ${settings?.nav?.defaultMode}; allowlist/trusted: ${allowAndTrust}`);
  expect(settings?.nav?.defaultMode).toBe("smart");
  expect(allowAndTrust).not.toMatch(/localhost|127\.0\.0\.1/);
}

test.afterEach(async () => {
  while (sinks.length) await sinks.pop()!.close().catch(() => undefined);
});

test("AI-47.4a / former AI-41: deceptive child frame is rolled back with a working Proceed; declared _top link and top-frame script stay", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const session = await AcceptanceSession.open(testInfo, "AI-47.4a-former-AI-41-PR636");
  try {
    await requireHead(session, PR_636_MERGE, "PR #636");

    await session.step("2. Smart mode; neither localhost nor 127.0.0.1 is allowlisted or trusted", () => smartAndNotTrusted(session));

    await session.step("4. deceptive: transparent same-origin frame over the visible player is rolled back; Proceed loads and stays", async () => {
      const armed = await armFixture(session, { id: "top-assign-100", primitive: "top-assign", delayMs: 100, input: "physical-click", layer: "hidden", role: "attack" });
      await armed.page.waitForTimeout(TYPED_ORIGIN_SETTLE_MS);
      await clickVisiblePlayer(armed);
      await expect.poll(() => armedEntry(armed, "child")?.trusted, { timeout: 3000, message: "the trusted click landed in the child layer" }).toBe(true);
      const notice = await expectRolledBackWithProceed(armed);
      session.note(`rollback notice: ${notice}`);
      await session.screenshot(armed.page, "4-rolled-back-notice");
      await installPageInputCounter(armed.page);
      await clickToastButton(armed.page, armed.page, "Proceed", "full");
      await expect.poll(() => onSink(armed.page), { timeout: 8000, message: "Proceed loads the destination" }).toBe(true);
      await armed.page.waitForTimeout(OBSERVATION_MS);
      expect(onSink(armed.page), "after Proceed the destination stays").toBe(true);
      expect(armed.sink.snapshot().receipts.length).toBe(2);
      await session.screenshot(armed.page, "4-proceed-destination");
    });

    await session.step("5. benign A: declared target=_top link in a visible frame, focused and activated with Enter, navigates with no rollback", async () => {
      const armed = await armFixture(session, { id: "benign-anchor-top-keyboard", primitive: "anchor-top", delayMs: 0, input: "keyboard", layer: "visible", role: "benign" });
      await armed.page.waitForTimeout(TYPED_ORIGIN_SETTLE_MS);
      await armed.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      let presses = 0;
      for (; presses < 10; presses += 1) {
        if (await armed.frame.evaluate(() => document.activeElement?.id === "declared-top-link")) break;
        await armed.page.keyboard.press("Tab");
      }
      expect(await armed.frame.evaluate(() => document.activeElement?.id), "link focused with Tab").toBe("declared-top-link");
      session.note(`Tab presses to reach the declared link: ${presses}`);
      await armed.page.keyboard.press("Enter");
      await expect.poll(() => armedEntry(armed, "child"), { timeout: 5000 }).toMatchObject({ input: "keyboard", trusted: true, detail: 0 });
      await expectBenignNavigationStays(armed, "declared _top link");
      expect(await toastCards(armed.page), "no prompt on the destination").toEqual([]);
    });

    await session.step("6. benign B: top-frame script navigation after a visible button click loads and stays", async () => {
      const armed = await armFixture(session, { id: "benign-top-script-100", primitive: "top-script", delayMs: 100, input: "top-physical-click", layer: "visible", role: "benign" });
      await armed.page.waitForTimeout(TYPED_ORIGIN_SETTLE_MS);
      await trustedClick(armed.page, "#visible-player-control");
      await expect.poll(() => armedEntry(armed, "parent")?.trusted, { timeout: 3000 }).toBe(true);
      await expectBenignNavigationStays(armed, "top-frame script");
    });

    await session.step("4-adversarial. the source page cannot script-click the rollback notice's Proceed", async () => {
      const armed = await armFixture(session, { id: "top-assign-1600", primitive: "top-assign", delayMs: 1600, input: "physical-click", layer: "hidden", role: "attack" });
      await armed.page.waitForTimeout(TYPED_ORIGIN_SETTLE_MS);
      await clickVisiblePlayer(armed);
      await expect.poll(() => armedEntry(armed, "child")?.trusted, { timeout: 3000 }).toBe(true);
      await expectRolledBackWithProceed(armed);
      await armed.page.waitForTimeout(1700);
      const reach = await armed.page.evaluate(() => {
        const button = Array.from(document.querySelectorAll("#__navsentinel_toast_host"))
          .flatMap((host) => Array.from(host.shadowRoot?.querySelectorAll("button") ?? []))
          .find((candidate) => candidate.textContent?.trim() === "Proceed") as HTMLButtonElement | undefined;
        if (!button) return "unreachable";
        button.click();
        return "clicked";
      });
      await armed.page.waitForTimeout(OBSERVATION_MS);
      const state = { reach, url: onSink(armed.page) ? "sink" : onFixture(armed) ? "fixture" : armed.page.url().split("?")[0], receipts: armed.sink.snapshot().receipts.length, cards: await toastCards(armed.page).catch(() => []) };
      session.note(`page-script Proceed on rollback notice: ${JSON.stringify(state)}`);
      await session.screenshot(armed.page, "4-adversarial-after-page-proceed");
      expect(state.url, "a page-script click must not take the rolled-back navigation").toBe("fixture");
      expect(state.receipts, "no second destination request").toBe(1);
    }, { soft: true });

    await session.step("8. no new console errors on page, popup or service worker", async () => {
      const errors = session.consoleErrors(CONSOLE_NOISE);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    }, { soft: true });

    await session.step("summary: every step above passed", async () => {
      expect(session.receipt.steps.filter((step) => step.status === "failed").map((step) => step.title)).toEqual([]);
    });
  } finally {
    await session.close();
  }
});

async function backReturnsNormally(session: AcceptanceSession, armed: Armed, label: string): Promise<void> {
  // A back/forward-cache restore fires no domcontentloaded, so wait for the commit only.
  await armed.page.goBack({ waitUntil: "commit", timeout: 15_000 });
  await expect.poll(() => onFixture(armed), { timeout: 8000, message: `${label}: Back returns to the source page` }).toBe(true);
  await session.requireReady(armed.page);
  session.note(`${label}: Back restored from bfcache=${await lastPageshowPersisted(armed.page)}`);
  await armed.page.waitForTimeout(2000);
  expect(onFixture(armed), `${label}: Back stays on the source page`).toBe(true);
  expect((await toastCards(armed.page)).filter((card) => /block|rolled back|suspicious/i.test(card.text)), `${label}: no false block after Back`).toEqual([]);
}

test("AI-47.4b / former AI-46: ordinary and declared child forms navigate with no false block; changed, unrelated and replayed targets stay denied", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const session = await AcceptanceSession.open(testInfo, "AI-47.4b-former-AI-46-PR649");
  try {
    await requireHead(session, PR_649_MERGE, "PR #649");
    await session.step("2. Smart mode; neither localhost nor 127.0.0.1 is allowlisted or trusted", () => smartAndNotTrusted(session));

    await session.step("5a. ordinary top-frame GET form navigates with no false block and Back returns normally", async () => {
      const armed = await armFixture(session, { id: "benign-top-form-submit-100", primitive: "top-form-submit-control", delayMs: 100, input: "top-physical-click", layer: "visible", role: "benign" });
      await armed.page.waitForTimeout(TYPED_ORIGIN_SETTLE_MS);
      await trustedClick(armed.page, "#top-submit-control");
      await expectBenignNavigationStays(armed, "top-frame GET form");
      await backReturnsNormally(session, armed, "top-frame GET form");
    });

    let replaySource: Armed | null = null;
    for (const [id, primitive] of [["benign-declared-form-submit-100", "declared-form-submit"], ["benign-declared-request-submit-100", "declared-request-submit"]] as const) {
      await session.step(`5b. embedded form that declares its submit control (${primitive}) navigates with no false block and Back returns`, async () => {
        const armed = await armFixture(session, { id, primitive, delayMs: 100, input: "physical-click", layer: "visible", role: "benign" });
        await armed.page.waitForTimeout(TYPED_ORIGIN_SETTLE_MS);
        const box = await armed.frame.locator("#declared-top-submit").boundingBox();
        await armed.page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await expect.poll(() => armedEntry(armed, "child")?.trusted, { timeout: 3000 }).toBe(true);
        await expectBenignNavigationStays(armed, primitive);
        await backReturnsNormally(session, armed, primitive);
        if (primitive === "declared-form-submit") replaySource = armed;
      });
      if (primitive === "declared-form-submit") {
        await session.step("4-replayed. after Back, a gesture-less re-submit of the same child form must not take the tab", async () => {
          expect(replaySource, "the declared-form arm ran").not.toBeNull();
          const armed = replaySource!;
          await armed.page.waitForTimeout(2000);
          const before = armed.sink.snapshot().receipts.length;
          // Playwright does not re-adopt a bfcache-restored child frame, so reach the same-origin child form from its parent.
          const replay = await armed.page.evaluate(() => {
            const child = (document.getElementById("hidden-media-layer") as HTMLIFrameElement).contentDocument;
            const form = child?.getElementById("top-submit-form") as HTMLFormElement | null;
            if (!form) return "child form unreachable";
            form.submit();
            return `submitted to ${new URL(form.action).origin}`;
          });
          session.note(`replay: ${replay}`);
          await armed.page.waitForTimeout(OBSERVATION_MS + 1500);
          const state = { receiptsDelta: armed.sink.snapshot().receipts.length - before, where: onSink(armed.page) ? "sink" : onFixture(armed) ? "fixture" : armed.page.url().split("?")[0] };
          session.note(`gesture-less replay after Back: ${JSON.stringify(state)} (${state.receiptsDelta === 0 ? "BLOCKED_PRE_HARM" : state.where === "fixture" ? "ROLLED_BACK" : "REACHED"})`);
          expect(state.where, "a replayed form target must not leave the tab on the destination").toBe("fixture");
        }, { soft: true });
      }
    }

    for (const [id, primitive, label] of [
      ["top-form-submit-100", "top-form-submit", "unrelated: bare-element click then form.submit(target=_top)"],
      ["empty-formaction-submit-100", "empty-formaction-submit", "changed: submitter declares this document, submit() goes elsewhere"],
    ] as const) {
      await session.step(`4-attack. ${label} is blocked before any request`, async () => {
        const armed = await armFixture(session, { id, primitive, delayMs: 100, input: "physical-click", layer: "hidden", role: "attack" });
        await armed.page.waitForTimeout(TYPED_ORIGIN_SETTLE_MS);
        // Same targets as the modelled regression: the bare layer, or the child submit control, both inside the ~transparent frame.
        const target = await armed.frame.locator(primitive === "empty-formaction-submit" ? "#declared-top-submit" : "#hidden-interactive-layer").boundingBox();
        await armed.page.mouse.click(target!.x + target!.width / 2, target!.y + target!.height / 2);
        await expect.poll(() => armedEntry(armed, "child")?.trusted, { timeout: 3000, message: "trusted click landed in the child" }).toBe(true);
        await armed.page.waitForTimeout(OBSERVATION_MS);
        const state = { receipts: armed.sink.snapshot().receipts.length, onFixture: onFixture(armed), cards: await toastCards(armed.page) };
        session.note(`${id}: ${JSON.stringify(state)}`);
        expect(state.receipts, "BLOCKED_PRE_HARM: no request reaches the destination").toBe(0);
        expect(state.onFixture).toBe(true);
      });
    }

    await session.step("6. no new console errors on page, popup or service worker", async () => {
      const errors = session.consoleErrors(CONSOLE_NOISE);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    }, { soft: true });

    await session.step("summary: every step above passed", async () => {
      expect(session.receipt.steps.filter((step) => step.status === "failed").map((step) => step.title)).toEqual([]);
    });
  } finally {
    await session.close();
  }
});
