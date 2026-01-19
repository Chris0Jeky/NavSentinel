import { computeCDS } from "../shared/scoring";
import { getSettings, onSettingsChange } from "../shared/storage";
import { makeToken, setActiveToken } from "../shared/stateMachine";
import type { Mode } from "../shared/types";
import { showToast } from "./ui_toast";
import { capturePointerDown, captureClick, buildClickContextFromEvents, type DownCapture } from "./dom_builder";
import { setDebugEnabled, updateDebugOverlay } from "./debug_overlay";

const CDS_BLOCK_THRESHOLD = 70;

let lastDown: DownCapture | null = null;
let settings = { defaultMode: "smart", debug: false };

async function initSettings() {
  settings = await getSettings();
  setDebugEnabled(settings.debug);
}

initSettings();

onSettingsChange((s) => {
  settings = s;
  setDebugEnabled(s.debug);
});

function siteKeyFromLocation(): string {
  return location.hostname;
}

function frameKey(): string {
  return window.top === window ? "top" : "frame";
}

window.addEventListener(
  "pointerdown",
  (e) => {
    if (!(e instanceof PointerEvent)) return;

    lastDown = capturePointerDown(e);

    const token = makeToken({
      siteKey: siteKeyFromLocation(),
      frameKey: frameKey(),
      mode: settings.defaultMode,
      pointer: {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey
      },
      cds: 0,
      reasonCodes: []
    });

    setActiveToken(token);
  },
  true
);

window.addEventListener(
  "click",
  (e) => {
    if (!(e instanceof MouseEvent)) return;

    const click = captureClick(e);
    const ctx = buildClickContextFromEvents({ down: lastDown, click });
    const { cds, reasonCodes } = computeCDS(ctx);

    const mode: Mode = settings.defaultMode;

    const token = makeToken({
      siteKey: siteKeyFromLocation(),
      frameKey: frameKey(),
      mode,
      pointer: lastDown
        ? {
            x: lastDown.x,
            y: lastDown.y,
            button: lastDown.button,
            ctrl: lastDown.ctrl,
            shift: lastDown.shift,
            alt: lastDown.alt,
            meta: lastDown.meta
          }
        : {
            x: e.clientX,
            y: e.clientY,
            button: 0,
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            alt: e.altKey,
            meta: e.metaKey
          },
      cds,
      reasonCodes
    });

    setActiveToken(token);

    let decision: "allow" | "block" = "allow";
    if (mode !== "off" && cds >= CDS_BLOCK_THRESHOLD) {
      decision = "block";
      e.preventDefault();
      e.stopImmediatePropagation();
      showToast({
        message: `NavSentinel blocked deceptive click (CDS=${cds}).`
      });
    }

    updateDebugOverlay({ mode, decision, cds, reasonCodes, ctx });

    if (settings.debug) {
      // eslint-disable-next-line no-console
      console.debug("[NavSentinel] click", { decision, cds, reasonCodes, ctx });
    }
  },
  true
);
