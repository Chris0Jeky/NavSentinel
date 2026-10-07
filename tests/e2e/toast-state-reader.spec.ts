import { expect, test } from "@playwright/test";
import { toastState } from "../acceptance/acceptance_harness";

test("toast reader empty state is not a block @regression", async ({ page }) => {
  await page.setContent("<body></body>");
  const state = await toastState(page);
  expect(state).toEqual({ text: null, buttons: [] });
  expect(state.text ?? "").not.toMatch(/block/i);
});

test("toast reader sees an idle shadow pill, then the later full card @regression", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "__navsentinel_toast_host";
    host.attachShadow({ mode: "open" }).innerHTML =
      '<div class="body">   </div><div class="pill idle">Heedline blocked 4 navigations</div>';
    document.body.appendChild(host);
  });
  expect(await toastState(page)).toEqual({
    text: "Heedline blocked 4 navigations",
    buttons: [],
  });

  await page.evaluate(() => {
    const root = document.querySelector("#__navsentinel_toast_host")?.shadowRoot;
    if (!root) throw new Error("missing toast shadow");
    const decoy = document.createElement("button");
    decoy.textContent = "Decoy";
    root.appendChild(decoy);

    const card = document.createElement("div");
    card.id = "__navsentinel_toast_host";
    card.attachShadow({ mode: "open" }).innerHTML =
      '<div class="body">Heedline blocked a deceptive click</div><button>Allow once</button><button style="display:none">Always allow</button>';
    document.body.appendChild(card);
  });
  expect(await toastState(page)).toEqual({
    text: "Heedline blocked a deceptive click",
    buttons: ["Allow once"],
  });
});
