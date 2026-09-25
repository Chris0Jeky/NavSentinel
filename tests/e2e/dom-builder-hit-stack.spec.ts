import { expect, test } from "@playwright/test";

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
