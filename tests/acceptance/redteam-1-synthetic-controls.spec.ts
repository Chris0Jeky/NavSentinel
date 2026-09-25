/**
 * Red-team acceptance (owner-sanctioned, defensive research on NavSentinel's own
 * `main` build): can an ordinary hostile web page activate NavSentinel's own
 * extension-owned prompt controls with page-synthesized (untrusted) clicks?
 *
 * Confirms/refutes open-PR defects #783/#784, #826/#827, #824/#825 on the
 * shipped build. The build-injected input fence (scripts/build-extension.mjs)
 * gates on `event.isTrusted` and only covers the toast host; the toast
 * `bindControl` direct listener and every credential-modal button listener have
 * no isTrusted check on main, so a synthetic click reaches the action.
 *
 * Attacker model: the page controls all script/DOM/timing but not trusted input.
 * The victim contributes at most ONE lured trusted click (Playwright mouse).
 * Assertions state the SECURE outcome: on main da3db0b6 A1b/A2/A3 are red
 * (harm reached); on the #784 and #827 heads they are green (2026-09-24).
 * Automated agent evidence, never an owner Gate-3 result.
 */
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, toastState, trustedClick } from "./acceptance_harness";
import { uniqueMarker, type Attempt } from "./redteam_helpers";

async function waitForModalButtons(page: Page, timeout = 9000): Promise<string[] | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const buttons = await page
      .evaluate(() => (window as unknown as { __modalButtons: () => string[] | null }).__modalButtons())
      .catch(() => null);
    if (buttons && buttons.length > 0) return buttons;
    await page.waitForTimeout(200);
  }
  return null;
}

const ev = <T = unknown>(page: Page, name: string, arg?: unknown) =>
  page.evaluate(
    ({ n, a }) => (window as unknown as Record<string, (x?: unknown) => T>)[n]!(a),
    { n: name, a: arg },
  );

test("red-team: page-synthetic clicks activate NavSentinel's own nav/credential/toast controls (main)", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "redteam-synthetic-controls");
  const attempts: Attempt[] = [];
  try {
    // ---- A1a: fully gestureless nav "Allow once" bypass (scripted submit) ----
    await session.step("A1a: gestureless synthetic 'Allow once' releases a blocked scripted navigation", async () => {
      const page = await session.newPage();
      const marker = uniqueMarker();
      await session.gotoReady(page, session.url("/acceptance/redteam-cred-modal.html"));
      // A scripted (gestureless) requestSubmit is caught by the MAIN-world nav
      // guard as a suspicious navigation -> "Blocked form submit" Allow toast.
      const action = await ev<string>(page, "__armCredentialSubmit", marker);
      session.note(`A1a armed scripted cross-site submit to ${action}`);
      await expect.poll(async () => (await toastState(page)).text, { timeout: 6000 }).not.toBeNull().catch(() => undefined);
      const toast = await toastState(page);
      session.note(`A1a nav toast: ${JSON.stringify(toast)}`);
      const hasAllow = toast.buttons.some((b) => b.startsWith("Allow"));
      await session.screenshot(page, "a1a-nav-allow-toast");
      // Without the Allow toast there is nothing to attack; fail rather than
      // record a vacuous "secure" pass (#873).
      expect(hasAllow, "the scripted submit must raise the Allow toast this step attacks").toBe(true);

      session.note(`A1a page before synthetic click: ${page.url()}`);
      const navigated = page.waitForURL((url) => url.href.includes(`/dest/${marker}/`), { timeout: 6000 })
        .then(() => true, () => false);
      const clicked = await ev<string>(page, "__synthClickToast", "Allow");
      // Read the toast straight after the click: it auto-hides after ~5 s, so a
      // read after the navigation wait cannot tell "consumed" from "expired" (#873).
      const after = await toastState(page);
      session.note(`A1a synthetic 'Allow once' -> ${clicked}`);
      const reachedNav = await navigated;
      const controlFired = clicked === "clicked" && (reachedNav || (toast.buttons.length > 0 && after.buttons.length === 0));
      session.note(`A1a reachedNav=${reachedNav} finalUrl=${page.url()} toastAfter=${JSON.stringify(after)} controlFired=${controlFired}`);
      attempts.push({
        id: "A1a",
        technique: "scripted requestSubmit() then untrusted .click() on nav 'Allow once' toast",
        fixture: "redteam-cred-modal.html",
        expected: "nav Allow prompt activates only on trusted input",
        observed: controlFired ? "REACHED-HARM" : "BLOCKED",
        finding: controlFired ? "NEW" : "KNOWN",
        detail: reachedNav
          ? `blocked scripted navigation released to ${page.url()} with zero trusted input`
          : controlFired
            ? "Allow-once action ran from a synthetic click (toast consumed)"
            : "synthetic click ignored",
      });
      session.note(`A1a control consumed by the synthetic click: ${controlFired}`);
      expect(reachedNav, "a synthetic click on the page toast's Allow once must not release the held navigation").toBe(false);
      if (!page.isClosed()) await page.close();
    }, { soft: true });

    // ---- A1b: credential-submit modal bypass after ONE lured trusted click ----
    await session.step("A1b: one lured trusted click reaches the credential modal; synthetic 'Proceed once' bypasses it", async () => {
      const page = await session.newPage();
      const marker = uniqueMarker();
      await session.gotoReady(page, session.url("/acceptance/redteam-cred-modal.html"));
      await ev(page, "__armCredentialForm", marker); // arm, do NOT submit
      // The victim is lured into ONE trusted click on the page's own Sign in
      // button (a real user gesture). NavSentinel's credential guard interposes.
      await trustedClick(page, "#submit");
      const buttons = await waitForModalButtons(page);
      session.note(`A1b modal buttons: ${JSON.stringify(buttons)}`);
      if (!buttons) {
        const t = await toastState(page).catch(() => null);
        session.note(`A1b no modal; toast=${JSON.stringify(t)} url=${page.url()}`);
      }
      expect(buttons, "trusted submit click must reach the credential-submit modal").not.toBeNull();
      expect(buttons ?? [], "modal offers Proceed once").toContain("Proceed once");
      await session.screenshot(page, "a1b-credential-modal");

      const before = page.url();
      const navigated = page.waitForURL((url) => url.href.includes(`/dest/${marker}/`), { timeout: 8000 })
        .then(() => true, () => false);
      const clicked = await ev<string>(page, "__synthClickModal", "Proceed once");
      session.note(`A1b synthetic 'Proceed once' -> ${clicked}`);
      const reached = await navigated;
      const finalUrl = page.url();
      session.note(`A1b before=${before} final=${finalUrl} reachedHarm=${reached}`);
      const crossSite = reached && new URL(finalUrl).hostname !== new URL(before).hostname;
      attempts.push({
        id: "A1b",
        technique: "one trusted submit click -> untrusted .click() on credential modal 'Proceed once'",
        fixture: "redteam-cred-modal.html",
        expected: "modal blocks the credential submit until the user's own trusted decision",
        observed: reached ? "REACHED-HARM" : "BLOCKED",
        finding: reached ? "NEW" : "KNOWN",
        detail: reached
          ? `password form submitted cross-site to ${finalUrl} without a trusted decision on the warning`
          : "synthetic modal click ignored",
      });
      session.note(`A1b cross-site submit resumed: ${crossSite}`);
      expect(reached, "a synthetic click on Proceed once must not submit the credential form (open fixes #784/#827)").toBe(false);
      if (!page.isClosed()) await page.close();
    }, { soft: true });

    // ---- A2: persistent trust poisoning via synthetic modal 'Trust' click ----
    await session.step("A2: synthetic 'Trust <site>' click on the modal persists trust (poisoning)", async () => {
      const page = await session.newPage();
      const marker = uniqueMarker();
      await session.gotoReady(page, session.url("/acceptance/redteam-cred-modal.html"));
      await ev(page, "__armCredentialForm", marker);
      await trustedClick(page, "#submit");
      const buttons = await waitForModalButtons(page);
      session.note(`A2 modal buttons: ${JSON.stringify(buttons)}`);
      const trustLabel = (buttons ?? []).find((b) => b.startsWith("Trust "));
      if (!trustLabel) {
        attempts.push({
          id: "A2", technique: "untrusted .click() on modal 'Trust <site>'", fixture: "redteam-cred-modal.html",
          expected: "trust persists only on a trusted user decision", observed: "NOT-APPLICABLE", finding: "CONTROL",
          detail: "no Trust action offered for this host",
        });
        session.note("A2 no Trust button offered; skipping");
        if (!page.isClosed()) await page.close();
        return;
      }
      const before = (await session.eventLog()).length;
      const clicked = await ev<string>(page, "__synthClickModal", trustLabel);
      session.note(`A2 synthetic Trust click (${trustLabel}) -> ${clicked}`);
      let trustEvent = false;
      await expect.poll(async () => {
        trustEvent = (await session.eventLog()).slice(before).some((row) => String(row.kind) === "cred_trust_domain");
        return trustEvent;
      }, { timeout: 6000 }).toBe(true).catch(() => undefined);
      session.note(`A2 cred_trust_domain observed: ${trustEvent}`);
      attempts.push({
        id: "A2", technique: "untrusted .click() on modal 'Trust <site>'", fixture: "redteam-cred-modal.html",
        expected: "trust persists only on a trusted user decision", observed: trustEvent ? "REACHED-HARM" : "BLOCKED",
        finding: trustEvent ? "NEW" : "KNOWN",
        detail: trustEvent ? "domain trust recorded from a synthetic click" : "no trust write",
      });
      expect(trustEvent, "a synthetic click on the modal Trust action must not persist trust (open fixes #784/#827)").toBe(false);
      if (!page.isClosed()) await page.close();
    }, { soft: true });

    // ---- A3: synthetic click on an extension-owned TOAST action (paste warn) ----
    await session.step("A3: synthetic click activates a toast action button (paste-warning 'Trust')", async () => {
      const page = await session.newPage();
      await session.gotoReady(page, session.url("/acceptance/redteam-paste-toast.html", "localhost"));
      const before = (await session.eventLog()).length;
      await ev(page, "__armPasteToast");
      await expect.poll(async () => (await toastState(page)).text, { timeout: 6000 }).not.toBeNull().catch(() => undefined);
      const toast = await toastState(page);
      session.note(`A3 toast: ${JSON.stringify(toast)}`);
      const trustBtn = toast.buttons.find((b) => b.startsWith("Trust"));
      expect(trustBtn, "paste-warning toast offers a Trust action").toBeTruthy();
      await session.screenshot(page, "a3-paste-toast");
      const clicked = await ev<string>(page, "__synthClickToast", "Trust");
      session.note(`A3 synthetic toast click -> ${clicked}`);
      let fired = false;
      await expect.poll(async () => {
        fired = (await session.eventLog()).slice(before).some((row) => String(row.kind) === "cred_trust_domain");
        return fired;
      }, { timeout: 6000 }).toBe(true).catch(() => undefined);
      const after = await toastState(page);
      const reached = fired || (toast.buttons.length > 0 && after.buttons.length === 0);
      session.note(`A3 after: toast=${JSON.stringify(after)} trustEvent=${fired} reached=${reached}`);
      attempts.push({
        id: "A3", technique: "untrusted .click() on toast action (bindControl direct listener)",
        fixture: "redteam-paste-toast.html", expected: "toast controls activate only on trusted input (fence)",
        observed: reached ? "REACHED-HARM" : "BLOCKED", finding: reached ? "NEW" : "KNOWN",
        detail: reached ? "toast action ran from a synthetic click (trust event / card removed)" : "synthetic click ignored",
      });
      expect(reached, "a synthetic click must not activate a toast action (open fixes #784/#827)").toBe(false);
      if (!page.isClosed()) await page.close();
    }, { soft: true });

    // ---- A4: modal layering / ownership (#824/#825 exposure) ----
    await session.step("A4: credential modal renders as a plain max-z host, not extension-owned top-layer (#824/#825)", async () => {
      const page = await session.newPage();
      const marker = uniqueMarker();
      await session.gotoReady(page, session.url("/acceptance/redteam-cred-modal.html"));
      await ev(page, "__armCredentialForm", marker);
      await trustedClick(page, "#submit");
      await waitForModalButtons(page);
      const shape = await page.evaluate(() => {
        const host = document.getElementById("__sentinelsuite_cred_modal_host__");
        if (!host) return null;
        return {
          hasPopover: host.hasAttribute("popover"),
          zIndex: host.style.zIndex,
          matchesPopoverOpen: (() => { try { return host.matches(":popover-open"); } catch { return false; } })(),
        };
      });
      session.note(`A4 modal host shape: ${JSON.stringify(shape)}`);
      const noTopLayer = !!shape && shape.hasPopover === false;
      attempts.push({
        id: "A4", technique: "inspect credential modal host layering / ownership registration",
        fixture: "redteam-cred-modal.html",
        expected: "own prompt sits in the top layer and is exempt from overlay classification",
        observed: noTopLayer ? "REACHED-HARM" : "BLOCKED", finding: noTopLayer ? "KNOWN" : "CONTROL",
        detail: noTopLayer ? "modal renders as a plain max-z host (no top-layer popover) on main" : "modal uses a top-layer popover",
      });
      expect(shape, "modal host is present").not.toBeNull();
      if (!page.isClosed()) await page.close();
    }, { soft: true });

    session.note(`REDTEAM-1 attempts: ${JSON.stringify(attempts)}`);
    session.observe("summary", JSON.stringify(attempts));
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    await session.close();
  }
});
