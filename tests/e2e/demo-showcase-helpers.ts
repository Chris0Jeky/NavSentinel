import type { Page } from "@playwright/test";

export type DemoExpectation = "block" | "allow" | "prompt" | "recover" | "inspect";

type DemoOverlayPayload = {
  step: number;
  total: number;
  title: string;
  summary: string;
  expectation: DemoExpectation;
};

const EXPECTATION_COPY: Record<DemoExpectation, string> = {
  block: "Expected outcome: NavSentinel stops the deceptive action before it lands.",
  allow: "Expected outcome: NavSentinel preserves clear, legitimate user intent.",
  prompt: "Expected outcome: NavSentinel interrupts the risky action before it can proceed.",
  recover: "Expected outcome: NavSentinel allows a narrow recovery path without over-trusting later actions.",
  inspect: "Expected outcome: This step highlights local state, controls, or evidence."
};

function getDemoScale(): number {
  const explicit = Number(process.env.NAVSENTINEL_DEMO_SCALE ?? "");
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  switch (process.env.NAVSENTINEL_DEMO_MODE) {
    case "fast":
      return 0.55;
    case "record":
      return 1.15;
    default:
      return 1;
  }
}

export function demoDelay(baseMs: number): number {
  return Math.max(50, Math.round(baseMs * getDemoScale()));
}

export async function demoPause(page: Page, baseMs: number): Promise<void> {
  await page.waitForTimeout(demoDelay(baseMs));
}

export async function showDemoOverlay(page: Page, payload: DemoOverlayPayload): Promise<void> {
  await page.evaluate(
    ({ step, total, title, summary, expectation, expectationCopy }) => {
      const overlayId = "__navsentinel_demo_overlay";
      const styleId = "__navsentinel_demo_overlay_style";

      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
          #${overlayId} {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 2147483647;
            width: min(430px, calc(100vw - 40px));
            color: #f6f7fb;
            font: 14px/1.48 "Segoe UI", "Helvetica Neue", sans-serif;
            letter-spacing: 0.01em;
            pointer-events: none;
          }

          #${overlayId} .card {
            border-radius: 18px;
            padding: 18px 18px 16px;
            box-shadow: 0 18px 40px rgba(8, 15, 32, 0.34);
            border: 1px solid rgba(255, 255, 255, 0.18);
            backdrop-filter: blur(10px);
            background:
              radial-gradient(circle at top left, rgba(255, 255, 255, 0.18), transparent 34%),
              linear-gradient(150deg, rgba(12, 19, 37, 0.95), rgba(23, 37, 68, 0.92));
          }

          #${overlayId}[data-tone="block"] .card {
            background:
              radial-gradient(circle at top left, rgba(255, 182, 182, 0.22), transparent 34%),
              linear-gradient(150deg, rgba(52, 15, 15, 0.96), rgba(121, 29, 29, 0.9));
          }

          #${overlayId}[data-tone="allow"] .card {
            background:
              radial-gradient(circle at top left, rgba(179, 255, 220, 0.2), transparent 34%),
              linear-gradient(150deg, rgba(9, 45, 34, 0.96), rgba(19, 107, 76, 0.9));
          }

          #${overlayId}[data-tone="prompt"] .card,
          #${overlayId}[data-tone="recover"] .card {
            background:
              radial-gradient(circle at top left, rgba(255, 223, 167, 0.22), transparent 34%),
              linear-gradient(150deg, rgba(63, 37, 8, 0.96), rgba(142, 91, 19, 0.9));
          }

          #${overlayId} .eyebrow {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.16em;
            opacity: 0.86;
          }

          #${overlayId} .title {
            margin: 0 0 8px;
            font-size: 24px;
            line-height: 1.12;
            font-weight: 700;
          }

          #${overlayId} .summary {
            margin: 0 0 12px;
            font-size: 14px;
            opacity: 0.96;
          }

          #${overlayId} .expectation {
            padding-top: 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.14);
            font-size: 13px;
            opacity: 0.94;
          }

          #${overlayId} .progress {
            margin-top: 14px;
            height: 5px;
            border-radius: 999px;
            overflow: hidden;
            background: rgba(255, 255, 255, 0.12);
          }

          #${overlayId} .progress > span {
            display: block;
            height: 100%;
            width: 0;
            border-radius: 999px;
            background: linear-gradient(90deg, #f6f7fb, rgba(255, 255, 255, 0.52));
          }
        `;
        document.head.appendChild(style);
      }

      let overlay = document.getElementById(overlayId);
      if (!overlay) {
        overlay = document.createElement("section");
        overlay.id = overlayId;
        overlay.innerHTML = `
          <div class="card">
            <div class="eyebrow">
              <span>NavSentinel guided demo</span>
              <span class="step"></span>
            </div>
            <h1 class="title"></h1>
            <p class="summary"></p>
            <div class="expectation"></div>
            <div class="progress"><span></span></div>
          </div>
        `;
        document.body.appendChild(overlay);
      }

      overlay.setAttribute("data-tone", expectation);
      const stepEl = overlay.querySelector(".step");
      const titleEl = overlay.querySelector(".title");
      const summaryEl = overlay.querySelector(".summary");
      const expectationEl = overlay.querySelector(".expectation");
      const progressEl = overlay.querySelector(".progress > span") as HTMLElement | null;

      if (stepEl) stepEl.textContent = `${step} / ${total}`;
      if (titleEl) titleEl.textContent = title;
      if (summaryEl) summaryEl.textContent = summary;
      if (expectationEl) expectationEl.textContent = expectationCopy;
      if (progressEl) {
        progressEl.style.width = `${Math.max(8, Math.round((step / total) * 100))}%`;
      }
    },
    {
      ...payload,
      expectationCopy: EXPECTATION_COPY[payload.expectation]
    }
  );
}
