import { computeCDS } from "../shared/scoring";
import { getSettings } from "../shared/storage";
import { makeToken, setActiveToken } from "../shared/stateMachine";

function siteKeyFromLocation(): string {
  // Stage 1: simple hostname. Later: registrable domain (eTLD+1).
  return location.hostname;
}

function frameKey(): string {
  // Stage 1: basic. Later: stable frame lineage if needed.
  return window.top === window ? "top" : "frame";
}

window.addEventListener(
  "pointerdown",
  async (e) => {
    if (!(e instanceof PointerEvent)) return;

    const settings = await getSettings();
    const { cds, reasonCodes } = computeCDS();

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
      cds,
      reasonCodes
    });

    setActiveToken(token);
    // Stage 1: log only
    // eslint-disable-next-line no-console
    console.debug("[NavSentinel] token", token);
  },
  true
);
