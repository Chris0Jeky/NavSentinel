import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import {
  CREDENTIAL_MODAL_HOST_ID,
  TOAST_HOST_ID,
  evaluateInCredentialModal,
  evaluateInToast,
  getServiceWorker,
  waitForCredentialModal,
  waitForNavSentinelBridge,
  waitForToastText,
} from "./extension_test_utils";

// #1226: a page @font-face applies inside closed shadow roots. Redefining the named
// families the prompt and toast used (with a ligature font) could show "Proceed once" as
// "Cancel". Generic families cannot be redefined, and the page can only reach the roots
// through properties inherited from the host, which the roots pin.
// The page also tries the generic names themselves (#1231 review): Chrome must not let a
// quoted @font-face family override a generic keyword.
const NAMED = ["-apple-system", "BlinkMacSystemFont", "Segoe UI Variable", "Segoe UI", "system-ui", "sans-serif", "monospace", "-webkit-sans-serif", "-webkit-monospace", "ui-sans-serif"];
const PAGE_CSS = `
  ${NAMED.map((family) => `@font-face { font-family: "${family}";
    src: local("Courier New"), local("DejaVu Sans Mono"), local("Liberation Mono"), local("Consolas"); }`).join("\n")}
  #${TOAST_HOST_ID}, #${CREDENTIAL_MODAL_HOST_ID} {
    -webkit-text-security: disc !important; -webkit-text-fill-color: transparent !important;
    font-feature-settings: "smcp" !important; font-variant-ligatures: discretionary-ligatures !important;
  }`;
const PROBES = `<span id="page-font" style="font-family:'Segoe UI'">Proceed once</span>
  <span id="system-font" style="font-family:system-ui">Proceed once</span>`;

type Node = { nodeId: number; nodeName: string; nodeValue?: string; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };

/** Platform fonts Chrome used to paint `label` (a page probe id, or a button label inside `hostId`'s closed root). */
async function paintedFonts(page: Page, hostId: string | null, label: string): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as { root: Node };
    const find = (node: Node, match: (node: Node) => boolean): Node | null => {
      if (match(node)) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
        const found = find(child, match);
        if (found) return found;
      }
      return null;
    };
    const idIs = (id: string) => (node: Node) => {
      const attributes = node.attributes ?? [];
      for (let i = 0; i < attributes.length; i += 2) if (attributes[i] === "id" && attributes[i + 1] === id) return true;
      return false;
    };
    let element: Node | null;
    if (hostId === null) element = find(root, idIs(label));
    else {
      const shadow = find(root, idIs(hostId))?.shadowRoots?.[0];
      element = shadow ? find(shadow, (node) => node.nodeName === "BUTTON" &&
        node.children?.some((child) => child.nodeValue?.trim() === label) === true) : null;
    }
    expect(element, `${label} must be rendered`).toBeTruthy();
    const { fonts } = (await cdp.send("CSS.getPlatformFontsForNode", { nodeId: element!.nodeId })) as { fonts: { familyName: string }[] };
    return fonts.map((font) => font.familyName);
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** Every text-bearing element in the roots: generic families only, and the pinned painting properties. */
function textStyle(roots: ShadowRoot[]) {
  const generic = new Set(["system-ui", "sans-serif", "monospace"]);
  const bad: string[] = [];
  let checked = 0;
  for (const root of roots) {
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (!Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.textContent!.trim())) continue;
      if (element.tagName === "STYLE") continue;
      checked++;
      const css = getComputedStyle(element);
      const families = css.fontFamily.split(",").map((family) => family.trim());
      const text = element.textContent!.trim().slice(0, 20);
      if (families.some((family) => !generic.has(family))) bad.push(`${text}: font-family ${css.fontFamily}`);
      const pinned = css as CSSStyleDeclaration & Record<string, string>;
      if (pinned.webkitTextSecurity !== "none") bad.push(`${text}: text-security ${pinned.webkitTextSecurity}`);
      if (pinned.webkitTextFillColor !== css.color) bad.push(`${text}: text-fill ${pinned.webkitTextFillColor}`);
      if (css.fontFeatureSettings !== "normal") bad.push(`${text}: features ${css.fontFeatureSettings}`);
      if (css.fontVariantLigatures !== "none") bad.push(`${text}: ligatures ${css.fontVariantLigatures}`);
    }
  }
  return { checked, bad };
}

async function launch(profilePrefix: string): Promise<{ context: BrowserContext; profile: string }> {
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(extensionPath), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve(`test-results/${profilePrefix}-`));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  return { context, profile };
}

/** The page's own font must really differ from what system-ui paints, or the font checks prove nothing. */
async function expectPageFontInjected(page: Page): Promise<string[]> {
  const injected = await paintedFonts(page, null, "page-font");
  const system = await paintedFonts(page, null, "system-font");
  expect(injected.length).toBeGreaterThan(0);
  expect(injected.filter((family) => system.includes(family)), "page @font-face must change the painted font").toEqual([]);
  return injected;
}

test("a page @font-face and host CSS cannot restyle the credential prompt's text (#1226) @regression", async () => {
  test.setTimeout(90_000);
  let context: BrowserContext | undefined;
  let profile = "";
  try {
    ({ context, profile } = await launch("approval-fonts-prompt"));
    const worker = await getServiceWorker(context);
    await worker.evaluate(async (key) => {
      await chrome.storage.local.set({ [key]: {
        credential: { mode: "smart", promptOnUntrustedDomain: true, blockHttpPasswordSubmit: false },
        nav: { defaultMode: "smart", debug: false },
      } });
    }, SUITE_SETTINGS_KEY);
    // All fixture requests are intercepted locally; credentials are dummy data.
    await context.route("http://victim.test/**", (route) => route.fulfill({ contentType: "text/html", body: `
      <style>${PAGE_CSS}</style>${PROBES}
      <form method="post" action="http://collector.test/collect">
        <input name="user" value="synthetic@example.invalid">
        <input name="password" type="password" value="dummy-fonts">
        <button id="go">Sign in</button>
      </form>` }));
    await context.route("http://collector.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<p>ok</p>" }));
    const page = await context.newPage();
    await page.goto("http://victim.test/login");
    await page.waitForTimeout(300);
    await page.click("#go", { noWaitAfter: true });
    await waitForCredentialModal(page);

    const injected = await expectPageFontInjected(page);
    const painted = await paintedFonts(page, CREDENTIAL_MODAL_HOST_ID, "Proceed once");
    expect(painted.filter((family) => injected.includes(family)), `Proceed once painted with ${painted}`).toEqual([]);
    // The prompt helper binds the root as `this`; hand it the same checker as source.
    const style = await evaluateInCredentialModal(page, function (this: ShadowRoot, source: string) {
      return (0, eval)(`(${source})`)([this]) as ReturnType<typeof textStyle>;
    }, textStyle.toString());
    expect(style!.checked).toBeGreaterThan(3);
    expect(style!.bad).toEqual([]);
  } finally {
    await context?.close();
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("a page @font-face and host CSS cannot restyle the toast's text (#1226) @regression", async () => {
  test.setTimeout(60_000);
  let context: BrowserContext | undefined;
  let profile = "";
  try {
    ({ context, profile } = await launch("approval-fonts-toast"));
    await context.route("http://toast.test/**", (route) => route.fulfill({
      contentType: "text/html", body: `<style>${PAGE_CSS}</style>${PROBES}<p>Local toast font fixture</p>`,
    }));
    const page = await context.newPage();
    await page.goto("http://toast.test/start");
    await waitForNavSentinelBridge(page);
    await page.evaluate(() => { window.open("http://toast.test/approved", "_blank"); });
    await waitForToastText(page, "Blocked popup");

    const injected = await expectPageFontInjected(page);
    const painted = await paintedFonts(page, TOAST_HOST_ID, "Allow once");
    expect(painted.filter((family) => injected.includes(family)), `Allow once painted with ${painted}`).toEqual([]);
    const style = await evaluateInToast(page, textStyle);
    expect(style.checked).toBeGreaterThan(3);
    expect(style.bad).toEqual([]);
  } finally {
    await context?.close();
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  }
});
