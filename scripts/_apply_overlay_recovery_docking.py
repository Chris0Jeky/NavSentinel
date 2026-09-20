from pathlib import Path
from textwrap import dedent


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement anchor, found {count}")
    target.write_text(text.replace(old, new), encoding="utf-8")


ui = "extension/src/content/ui_toast.ts"

replace_once(
    ui,
    dedent("""\
      briefRecovery?: boolean;
    };
    """),
    dedent("""\
      briefRecovery?: boolean;
      /**
       * Retain overlay-cleanup Undo until explicit activation or feature shutdown.
       * The initial chip docks to a smaller edge control after the brief window or
       * a trusted outside interaction, preserving authority without obstructing the page.
       */
      retainedRecovery?: boolean;
    };
    """),
)

replace_once(
    ui,
    '  host.style.gap = "8px";\n',
    '  host.style.gap = "8px";\n  // Only extension-owned controls accept input; the host box never blocks the page.\n  host.style.pointerEvents = "none";\n',
)

replace_once(
    ui,
    "style.textContent = `.wrap{",
    "style.textContent = `.wrap{pointer-events:auto;",
)

replace_once(
    ui,
    ".brief-recovery button{padding:4px 7px;font-size:10px;}.pill{",
    ".brief-recovery button{padding:4px 7px;font-size:10px;}"
    ".retained-recovery.recovery-docked{position:fixed;top:12px;right:12px;width:auto;min-width:0;grid-template-columns:auto auto;border-radius:999px;animation:none;}"
    ".retained-recovery.recovery-docked .head{padding-left:8px;}"
    ".retained-recovery.recovery-docked .body{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}"
    ".retained-recovery.recovery-docked .row{padding:4px 5px 4px 0;}"
    ".retained-recovery.recovery-docked button{padding:4px 7px;}"
    ".pill{",
)

replace_once(
    ui,
    dedent("""\
      const wrap = document.createElement("div");
      wrap.className = opts.briefRecovery ? "wrap brief-recovery" : "wrap";
      wrap.setAttribute("role", opts.briefRecovery ? "status" : "alert");
      if (opts.briefRecovery) {
        wrap.setAttribute("aria-live", "polite");
        wrap.setAttribute("aria-atomic", "true");
        wrap.setAttribute("aria-label", `NavSentinel: ${opts.message}`);
      }
      if (opts.persistent) wrap.dataset.persistent = "true";
    """),
    dedent("""\
      const isRecovery = opts.briefRecovery === true || opts.retainedRecovery === true;
      const wrap = document.createElement("div");
      wrap.className = isRecovery ? "wrap brief-recovery" : "wrap";
      if (opts.retainedRecovery) wrap.classList.add("retained-recovery");
      wrap.setAttribute("role", isRecovery ? "status" : "alert");
      if (isRecovery) {
        wrap.setAttribute("aria-live", "polite");
        wrap.setAttribute("aria-atomic", "true");
        wrap.setAttribute("aria-label", `NavSentinel: ${opts.message}`);
      }
      if (opts.persistent) wrap.dataset.persistent = "true";
      if (opts.retainedRecovery) wrap.dataset.recoveryDocked = "false";
    """),
)

replace_once(
    ui,
    dedent("""\
      let actionClicked = false;
      let removed = false;
      let timeout = 0;
      let outsidePointerDown: ((event: PointerEvent) => void) | null = null;
      const remove = (notifyDismiss = false) => {
        if (removed) return;
        removed = true;
        if (timeout) window.clearTimeout(timeout);
        if (outsidePointerDown) {
          document.removeEventListener("pointerdown", outsidePointerDown, true);
        }
        cardRemovers.delete(wrap);
    """),
    dedent("""\
      let actionClicked = false;
      let removed = false;
      let timeout = 0;
      let recoveryDockTimer = 0;
      let outsidePointerDown: ((event: PointerEvent) => void) | null = null;
      const detachOutsidePointer = () => {
        if (!outsidePointerDown) return;
        document.removeEventListener("pointerdown", outsidePointerDown, true);
        outsidePointerDown = null;
      };
      const dockRetainedRecovery = () => {
        if (removed || !opts.retainedRecovery || wrap.dataset.recoveryDocked === "true") return;
        if (recoveryDockTimer) {
          window.clearTimeout(recoveryDockTimer);
          recoveryDockTimer = 0;
        }
        detachOutsidePointer();
        wrap.classList.add("recovery-docked");
        wrap.dataset.recoveryDocked = "true";
      };
      const remove = (notifyDismiss = false) => {
        if (removed) return;
        removed = true;
        if (timeout) window.clearTimeout(timeout);
        if (recoveryDockTimer) window.clearTimeout(recoveryDockTimer);
        detachOutsidePointer();
        cardRemovers.delete(wrap);
    """),
)

replace_once(
    ui,
    '  if (!opts.briefRecovery) {\n',
    '  if (!isRecovery) {\n',
)

replace_once(
    ui,
    dedent("""\
      if (opts.briefRecovery && opts.timeoutMs !== 0) {
        outsidePointerDown = (event: PointerEvent) => {
          if (!event.isTrusted || event.composedPath().includes(wrap)) return;
          remove();
        };
        document.addEventListener("pointerdown", outsidePointerDown, true);
      }

      const t = opts.timeoutMs ?? (opts.briefRecovery ? BRIEF_RECOVERY_DISMISS_MS : 4000);
      if (t > 0) {
        timeout = window.setTimeout(() => remove(!opts.briefRecovery), t);
      }
    """),
    dedent("""\
      if (opts.retainedRecovery) {
        outsidePointerDown = (event: PointerEvent) => {
          if (!event.isTrusted || event.composedPath().includes(wrap)) return;
          dockRetainedRecovery();
        };
        document.addEventListener("pointerdown", outsidePointerDown, true);
        recoveryDockTimer = window.setTimeout(
          dockRetainedRecovery,
          BRIEF_RECOVERY_DISMISS_MS,
        );
      } else if (opts.briefRecovery && opts.timeoutMs !== 0) {
        outsidePointerDown = (event: PointerEvent) => {
          if (!event.isTrusted || event.composedPath().includes(wrap)) return;
          remove();
        };
        document.addEventListener("pointerdown", outsidePointerDown, true);
      }

      const t = opts.retainedRecovery
        ? 0
        : opts.timeoutMs ?? (opts.briefRecovery ? BRIEF_RECOVERY_DISMISS_MS : 4000);
      if (t > 0) {
        timeout = window.setTimeout(() => remove(!opts.briefRecovery), t);
      }
    """),
)

replace_once(
    ui,
    dedent("""\
    /** Show the bounded, low-stakes recovery surface for automatic overlay cleanup. */
    export function showOverlayCleanupToast(onUndo: () => void): void {
      showToast({
        message: "Overlay hidden; still watching.",
        actions: [{ label: "Undo", onClick: onUndo }],
        persistent: true,
        briefRecovery: true,
        timeoutMs: 0,
      });
    }
    """),
    dedent("""\
    /** Show retained overlay-cleanup recovery without permanently covering page controls. */
    export function showOverlayCleanupToast(onUndo: () => void): void {
      showToast({
        message: "Overlay hidden; still watching.",
        actions: [{ label: "Undo", onClick: onUndo }],
        persistent: true,
        retainedRecovery: true,
      });
    }
    """),
)

nesting = "tests/e2e/overlay-cleanup-nesting.spec.ts"
replace_once(
    nesting,
    'test("cleanup recovery notice is small and leaves after two seconds or an outside interaction @regression", async () => {',
    'test("cleanup recovery notice docks without losing Undo after time or outside interaction @regression", async () => {',
)

replace_once(
    nesting,
    dedent("""\
        await expect(notice).toHaveCount(0);
        await expect(frame.locator("#exact-overlay-frame")).toBeHidden();

        await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    """),
    dedent("""\
        await expect(notice).toHaveAttribute("data-recovery-docked", "true");
        await expect(notice).toBeVisible();
        await expect(frame.locator("#exact-overlay-frame")).toBeHidden();
        await notice.getByRole("button", { name: "Undo", exact: true }).click();
        await expect(frame.locator("#exact-overlay-frame")).toBeVisible();

        await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    """),
)

replace_once(
    nesting,
    dedent("""\
        frame = await childFrame(page, "exact");
        await waitForFrameToast(frame, /overlay hidden/i);
        await expect(frame.locator("#__navsentinel_toast_host .wrap[data-persistent='true']"))
          .toHaveCount(0, { timeout: 3000 });
        await expect(frame.locator("#exact-overlay-frame")).toBeHidden();
    """),
    dedent("""\
        frame = await childFrame(page, "exact");
        await waitForFrameToast(frame, /overlay hidden/i);
        const timedNotice = frame.locator(
          "#__navsentinel_toast_host .wrap[data-persistent='true']",
        );
        await expect(timedNotice).toHaveCount(1);
        await expect(timedNotice).toHaveAttribute(
          "data-recovery-docked",
          "true",
          { timeout: 3000 },
        );
        await expect(timedNotice).toBeVisible();
        await expect(frame.locator("#exact-overlay-frame")).toBeHidden();
    """),
)

replace_once(
    nesting,
    dedent("""\
        await expect(notice).toHaveCount(0, { timeout: 3000 });
        await confirm.click();
    """),
    dedent("""\
        await expect(notice).toHaveAttribute(
          "data-recovery-docked",
          "true",
          { timeout: 3000 },
        );
        await expect(notice).toBeVisible();
        const dockedNoticeBox = await notice.boundingBox();
        const dockedConfirmBox = await confirm.boundingBox();
        expect(dockedNoticeBox).not.toBeNull();
        expect(dockedConfirmBox).not.toBeNull();
        expect(
          dockedNoticeBox!.x < dockedConfirmBox!.x + dockedConfirmBox!.width &&
          dockedNoticeBox!.x + dockedNoticeBox!.width > dockedConfirmBox!.x &&
          dockedNoticeBox!.y < dockedConfirmBox!.y + dockedConfirmBox!.height &&
          dockedNoticeBox!.y + dockedNoticeBox!.height > dockedConfirmBox!.y,
        ).toBe(false);
        await confirm.click();
    """),
)

replace_once(
    nesting,
    dedent("""\
          const frame = await childFrame(page, fixtureCase, index);
          await expect(frame.locator("#__navsentinel_toast_host .wrap[data-persistent='true']"))
            .toHaveCount(0, { timeout: 3000 });
    """),
    dedent("""\
          const frame = await childFrame(page, fixtureCase, index);
          const recovery = frame.locator(
            "#__navsentinel_toast_host .wrap[data-persistent='true']",
          );
          await expect(recovery).toHaveCount(1);
          await expect(recovery).toHaveAttribute(
            "data-recovery-docked",
            "true",
            { timeout: 3000 },
          );
    """),
)

phase2 = "tests/e2e/phase2-detections.spec.ts"
replace_once(
    phase2,
    '  test("mutation-05 brief notice expiry keeps later cleanup active without reopening it @phase2", async () => {',
    '  test("mutation-05 retained recovery keeps later cleanup active after docking @phase2", async () => {',
)

replace_once(
    phase2,
    dedent("""\
          await expect(page.locator("#__navsentinel_toast_host .brief-recovery"))
            .toHaveCount(0, { timeout: 3000 });
          await page.evaluate(() => {
    """),
    dedent("""\
          const recovery = page.locator(
            "#__navsentinel_toast_host .brief-recovery[data-persistent='true']",
          );
          await expect(recovery).toHaveCount(1);
          await expect(recovery).toHaveAttribute(
            "data-recovery-docked",
            "true",
            { timeout: 3000 },
          );
          await page.evaluate(() => {
    """),
)

replace_once(
    phase2,
    dedent("""\
          for (const selector of ["#trap-a", "#trap-b", "#trap-c"]) {
            await expect(page.locator(selector)).toBeHidden();
          }
          await assertNoToastFor(page, 600);
          expect(context.pages()).toHaveLength(originalPageCount);

          await updateNavigationSettings(context, { autoDismissOverlays: false });
    """),
    dedent("""\
          for (const selector of ["#trap-a", "#trap-b", "#trap-c"]) {
            await expect(page.locator(selector)).toBeHidden();
          }
          await expect(page.locator(
            "#__navsentinel_toast_host .wrap:not([data-persistent='true'])",
          )).toHaveCount(0);
          await expect(recovery).toHaveCount(1);
          expect(context.pages()).toHaveLength(originalPageCount);

          await updateNavigationSettings(context, { autoDismissOverlays: false });
          await expect(recovery).toHaveCount(0);
    """),
)

Path("tests/overlay-cleanup-recovery-ui.test.ts").write_text(
    dedent("""\
    // @vitest-environment happy-dom
    import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

    type ToastModule = typeof import("../extension/src/content/ui_toast");

    let showOverlayCleanupToast: ToastModule["showOverlayCleanupToast"];

    function getRoot(): ShadowRoot | null {
      return document.documentElement
        .querySelector<HTMLElement>("#__navsentinel_toast_host")
        ?.shadowRoot ?? null;
    }

    function getRecoveryCard(): HTMLElement | null {
      return getRoot()?.querySelector<HTMLElement>(".wrap.retained-recovery") ?? null;
    }

    describe("overlay cleanup recovery UI", () => {
      beforeEach(async () => {
        vi.resetModules();
        vi.useFakeTimers();
        document.documentElement
          .querySelectorAll("#__navsentinel_toast_host")
          .forEach((node) => node.remove());
        ({ showOverlayCleanupToast } = await import("../extension/src/content/ui_toast"));
      });

      afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.documentElement
          .querySelectorAll("#__navsentinel_toast_host")
          .forEach((node) => node.remove());
      });

      it("docks instead of expiring and retains Undo until explicit activation", () => {
        const undo = vi.fn();

        showOverlayCleanupToast(undo);

        expect(getRecoveryCard()).not.toBeNull();
        expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("false");

        // Page-synthetic input cannot move or retire an extension recovery control.
        document.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
        expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("false");

        vi.advanceTimersByTime(2_001);
        expect(getRecoveryCard()).not.toBeNull();
        expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("true");
        expect(getRecoveryCard()?.classList.contains("recovery-docked")).toBe(true);
        expect(undo).not.toHaveBeenCalled();

        vi.advanceTimersByTime(60_000);
        expect(getRecoveryCard()).not.toBeNull();

        const button = getRecoveryCard()!.querySelector<HTMLButtonElement>("button");
        expect(button?.textContent).toBe("Undo");
        button!.click();

        expect(undo).toHaveBeenCalledTimes(1);
        expect(getRecoveryCard()).toBeNull();
      });
    });
    """),
    encoding="utf-8",
)

Path(".github/workflows/_apply-overlay-recovery-docking.yml").unlink()
Path("scripts/_apply_overlay_recovery_docking.py").unlink()
