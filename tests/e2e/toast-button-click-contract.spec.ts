import { expect, test } from "@playwright/test";
import { clickToastButton } from "../acceptance/page_ui_helpers";

// Synthetic page UI only: prove the harness delivers trusted input to the
// selected button after its geometry settles, including inside a child frame.
for (const childFrame of [false, true]) {
  test(`toast button click waits for stable geometry in ${childFrame ? "child frame" : "top page"} @regression`, async ({ page }) => {
    await page.setContent(childFrame
      ? '<iframe style="width:400px;height:400px" srcdoc="<body></body>"></iframe>'
      : "<body></body>");
    const scope = childFrame ? page.frames().find(frame => frame.parentFrame() === page.mainFrame())! : page;
    await scope.evaluate(() => {
      const host = document.createElement("div");
      host.id = "__navsentinel_toast_host";
      host.attachShadow({ mode: "open" }).innerHTML = `
        <style>
          .wrap { position: fixed; left: 20px; top: 20px; }
          button { width: 100px; height: 40px; }
        </style>
        <div class="wrap brief-recovery"><button>Undo</button></div>`;
      document.body.appendChild(host);
      const card = host.shadowRoot!.querySelector<HTMLElement>(".wrap")!;
      card.animate([{ transform: "translateY(0)" }, { transform: "translateY(160px)" }], {
        duration: 400, fill: "forwards",
      });
      host.shadowRoot!.querySelector("button")!.addEventListener("click", event => {
        document.body.dataset.clickTrusted = String(event.isTrusted);
        document.body.dataset.clickCount = String(Number(document.body.dataset.clickCount ?? 0) + 1);
      });
    });

    // A delayed coordinate command can land after the sampled button moves.
    // Keep the actual browser input; hold only this harness API's dispatch so
    // that the predecessor's stale-point race has a deterministic oracle.
    const nativeClick = page.mouse.click.bind(page.mouse);
    page.mouse.click = async (x, y, options) => {
      await page.waitForTimeout(450);
      await nativeClick(x, y, options);
    };
    try {
      await clickToastButton(page, scope, "Undo", "brief");
    } finally {
      page.mouse.click = nativeClick;
    }

    expect(await scope.evaluate(() => ({
      trusted: document.body.dataset.clickTrusted,
      count: document.body.dataset.clickCount,
    }))).toEqual({ trusted: "true", count: "1" });
  });
}
