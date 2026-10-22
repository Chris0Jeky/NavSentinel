import { expect, test } from "@playwright/test";
import { build } from "vite";

test("transparent text fill keeps a glyph rect beneath a concealed child (#886) @regression", async ({ page }) => {
  await page.setContent(`
    <a id="control" href="#" style="position:relative;display:block;width:120px;height:30px;color:BLACK;-webkit-text-fill-color:TRANSPARENT">
      Hidden<span id="concealed" style="position:absolute;inset:0;opacity:0.01"></span>
    </a>
  `);
  const measured = await page.evaluate(() => {
    const link = document.getElementById("control")!;
    const colorCaseProbe = document.createElement("span");
    colorCaseProbe.style.color = "TRANSPARENT";
    document.body.append(colorCaseProbe);
    const text = Array.from(link.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("Hidden"))!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const rect = range.getClientRects()[0]!;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return {
      fill: getComputedStyle(link).getPropertyValue("-webkit-text-fill-color"),
      computedTransparentColor: getComputedStyle(colorCaseProbe).color,
      glyphWidth: rect.width,
      hits: document.elementsFromPoint(x, y).slice(0, 2).map((element) => element.id),
    };
  });
  expect(measured.fill).toMatch(/transparent|rgba\([^)]*,\s*0\)|rgb\([^)]*\/\s*0\)/);
  expect(measured.computedTransparentColor).toMatch(/transparent|rgba\([^)]*,\s*0\)|rgb\([^)]*\/\s*0\)/);
  expect(measured.glyphWidth).toBeGreaterThan(0);
  expect(measured.hits).toEqual(["concealed", "control"]);
});

test("zero-width direct text has no painted width over a concealed link child (#886) @regression", async ({ page }) => {
  await page.setContent(`
    <a id="control" href="#" style="display:block;width:40vw;height:40vh">
      &#8203;<span id="concealed" style="display:block;height:100%;opacity:0.01">Continue</span>
    </a>
  `);
  const measured = await page.evaluate(() => {
    const link = document.getElementById("control")!;
    const text = Array.from(link.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("\u200b"))!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const rect = range.getClientRects()[0]!;
    const child = document.getElementById("concealed")!.getBoundingClientRect();
    const x = child.left + 20;
    const y = child.top + 20;
    return {
      directTextWidth: rect.width,
      hits: document.elementsFromPoint(x, y).slice(0, 2).map((element) => element.id),
    };
  });
  expect(measured.directTextWidth).toBe(0);
  expect(measured.hits).toEqual(["concealed", "control"]);
});

test("an escaped fixed child does not put its tiny link in the hit stack (#886) @regression", async ({ page }) => {
  await page.setContent(`
    <a id="attacker" href="#">tiny
      <span id="escaped" style="position:fixed;z-index:10;left:100px;top:100px;width:100px;height:100px;opacity:0.1"></span>
    </a>
    <button id="victim" style="position:fixed;left:100px;top:100px;width:100px;height:100px">Delete</button>
  `);
  const hits = await page.evaluate(() => document.elementsFromPoint(150, 150).map((element) => element.id));
  expect(hits.slice(0, 2)).toEqual(["escaped", "victim"]);
  expect(hits).not.toContain("attacker");
});

test("a slotted child exposes its concealed shadow wrapper through assignedSlot (#886) @regression", async ({ page }) => {
  await page.setContent('<a href="#"><x-surface id="host"><span id="child">Continue</span></x-surface></a>');
  const measured = await page.evaluate(() => {
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    const wrapper = document.createElement("div");
    wrapper.style.opacity = "0.01";
    const slot = document.createElement("slot");
    wrapper.appendChild(slot);
    shadow.appendChild(wrapper);
    const child = document.getElementById("child")!;
    return {
      assigned: child.assignedSlot === slot,
      parentSkipsWrapper: child.parentElement === host,
      wrapperOpacity: getComputedStyle(child.assignedSlot!.parentElement!).opacity,
    };
  });
  expect(measured).toEqual({ assigned: true, parentSkipsWrapper: true, wrapperOpacity: "0.01" });
});

test.describe("top-layer click scoring (#925)", () => {
  let scoringScript: string;
  test.beforeAll(async () => {
    // Bundle the real click path without a server, extension profile, or a test
    // implementation of effectiveOpacity. Run it in a content-script-like
    // isolated world so page-world shims cannot supply top-layer state.
    const entry = "\0click-scoring-test";
    const result = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [{
        name: "click-scoring-test",
        resolveId: (id) => id === entry ? entry : undefined,
        load: (id) => id === entry ? `
          export * from ${JSON.stringify(`${process.cwd().replaceAll("\\", "/")}/extension/src/content/dom_builder.ts`)};
          export { computeCDS } from ${JSON.stringify(`${process.cwd().replaceAll("\\", "/")}/extension/src/shared/scoring.ts`)};
        ` : undefined,
      }],
      build: {
        write: false,
        minify: false,
        rolldownOptions: {
          input: entry,
          preserveEntrySignatures: "strict",
          output: { format: "iife", name: "ClickScoring" },
        },
      },
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (!output || !("output" in output)) throw new Error("Missing click-scoring bundle");
    const chunk = output.output.find((file) => file.type === "chunk");
    if (!chunk || chunk.type !== "chunk") throw new Error("Missing click-scoring script");
    scoringScript = chunk.code;
  });

  for (const mode of ["modal", "popover", "ordinary"] as const) {
    test(`${mode} uses rendered opacity for a trusted click @regression`, async ({ page }) => {
      await page.setContent(`
        <div id="outer" style="opacity:0.01">
          <${mode === "modal" ? "dialog" : "div"} id="surface" ${mode === "popover" ? 'popover="manual"' : ""}>
            <div id="inner"><a id="link" href="#destination" style="display:block;width:160px;height:32px">Read the article</a></div>
          </${mode === "modal" ? "dialog" : "div"}>
        </div>
      `);
      const state = await page.evaluate((mode) => {
        const surface = document.getElementById("surface")!;
        if (mode === "modal") (surface as HTMLDialogElement).showModal();
        if (mode === "popover") surface.showPopover();
        return {
          modal: surface.matches(":modal"),
          popover: surface.matches(":popover-open"),
          ownOpacity: getComputedStyle(surface).opacity,
          ancestorOpacity: getComputedStyle(document.getElementById("outer")!).opacity,
        };
      }, mode);
      expect(state).toEqual({
        modal: mode === "modal", popover: mode === "popover", ownOpacity: "1", ancestorOpacity: "0.01",
      });

      const cdp = await page.context().newCDPSession(page);
      try {
        const { frameTree } = await cdp.send("Page.getFrameTree");
        const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
          frameId: frameTree.frame.id, worldName: "click-scoring-925",
        });
        const installed = await cdp.send("Runtime.evaluate", {
          contextId: executionContextId,
          expression: `${scoringScript}
            let down = null;
            let lastScore = null;
            document.addEventListener('pointerdown', e => { down = ClickScoring.capturePointerDown(e); }, true);
            document.addEventListener('click', e => {
              e.preventDefault();
              const ctx = ClickScoring.buildClickContextFromEvents({ down, click: ClickScoring.captureClick(e) });
              lastScore = { trusted: e.isTrusted, opacity: ctx.top.opacity, ...ClickScoring.computeCDS(ctx) };
            }, true);
          `,
        });
        expect(installed.exceptionDetails).toBeUndefined();
        await page.locator("#link").click();
        const readScore = async () => {
          const result = await cdp.send("Runtime.evaluate", {
            contextId: executionContextId, expression: "lastScore", returnByValue: true,
          });
          expect(result.exceptionDetails).toBeUndefined();
          return result.result.value;
        };
        const score = await readScore();
        if (mode === "ordinary") {
          expect(score.trusted).toBe(true);
          expect(score.opacity).toBe(0.01);
          expect(score.reasonCodes).toContain("invisible_but_clickable");
        } else {
          expect(score).toEqual({ trusted: true, opacity: 1, cds: 0, reasonCodes: [] });
          await page.evaluate(() => {
            document.getElementById("surface")!.style.opacity = "0.2";
            document.getElementById("inner")!.style.opacity = "0.25";
            document.getElementById("link")!.style.opacity = "0.5";
          });
          await page.locator("#link").click();
          const concealed = await readScore();
          expect(concealed.trusted).toBe(true);
          expect(concealed.opacity).toBeCloseTo(0.025, 6);
          expect(concealed.reasonCodes).toContain("invisible_but_clickable");
        }
      } finally {
        await cdp.detach();
      }
    });
  }
});
