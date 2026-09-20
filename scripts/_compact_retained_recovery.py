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
text = Path(ui).read_text(encoding="utf-8")

retained_option = dedent("""\
  /**
   * Retain overlay-cleanup Undo until explicit activation or feature shutdown.
   * The initial chip docks to a smaller edge control after the brief window or
   * a trusted outside interaction, preserving authority without obstructing the page.
   */
  retainedRecovery?: boolean;
""")
if text.count(retained_option) != 1:
    raise RuntimeError("retainedRecovery option block changed unexpectedly")
text = text.replace(retained_option, "")

if text.count(".retained-recovery.recovery-docked") != 5:
    raise RuntimeError("retained recovery CSS selector count changed unexpectedly")
text = text.replace(".retained-recovery.recovery-docked", ".recovery-docked")
text = text.replace(
    ".recovery-docked .body{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}",
    ".recovery-docked .body{display:none;}",
)

old_setup = dedent("""\
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
""")
new_setup = dedent("""\
  const isRecovery = opts.briefRecovery === true;
  const retainedRecovery = isRecovery && opts.persistent === true && opts.timeoutMs === 0;
  const wrap = document.createElement("div");
  wrap.className = isRecovery ? "wrap brief-recovery" : "wrap";
  wrap.setAttribute("role", isRecovery ? "status" : "alert");
  if (isRecovery) {
    wrap.setAttribute("aria-live", "polite");
    wrap.setAttribute("aria-atomic", "true");
    wrap.setAttribute("aria-label", `NavSentinel: ${opts.message}`);
  }
  if (opts.persistent) wrap.dataset.persistent = "true";
""")
if text.count(old_setup) != 1:
    raise RuntimeError("recovery card setup changed unexpectedly")
text = text.replace(old_setup, new_setup)

old_lifecycle = dedent("""\
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
""")
new_lifecycle = dedent("""\
  let actionClicked = false;
  let removed = false;
  let timeout = 0;
  let outsidePointerDown: ((event: PointerEvent) => void) | null = null;
  const detachOutsidePointer = () => {
    if (!outsidePointerDown) return;
    document.removeEventListener("pointerdown", outsidePointerDown, true);
    outsidePointerDown = null;
  };
  const dockRetainedRecovery = () => {
    if (removed || !retainedRecovery || wrap.classList.contains("recovery-docked")) return;
    if (timeout) {
      window.clearTimeout(timeout);
      timeout = 0;
    }
    detachOutsidePointer();
    wrap.classList.add("recovery-docked");
  };
  const remove = (notifyDismiss = false) => {
    if (removed) return;
    removed = true;
    if (timeout) window.clearTimeout(timeout);
    detachOutsidePointer();
""")
if text.count(old_lifecycle) != 1:
    raise RuntimeError("recovery lifecycle changed unexpectedly")
text = text.replace(old_lifecycle, new_lifecycle)

old_schedule = dedent("""\
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
""")
new_schedule = dedent("""\
  if (retainedRecovery) {
    outsidePointerDown = (event: PointerEvent) => {
      if (!event.isTrusted || event.composedPath().includes(wrap)) return;
      dockRetainedRecovery();
    };
    document.addEventListener("pointerdown", outsidePointerDown, true);
    timeout = window.setTimeout(dockRetainedRecovery, BRIEF_RECOVERY_DISMISS_MS);
  } else if (opts.briefRecovery && opts.timeoutMs !== 0) {
    outsidePointerDown = (event: PointerEvent) => {
      if (!event.isTrusted || event.composedPath().includes(wrap)) return;
      remove();
    };
    document.addEventListener("pointerdown", outsidePointerDown, true);
  }

  const t = retainedRecovery
    ? 0
    : opts.timeoutMs ?? (opts.briefRecovery ? BRIEF_RECOVERY_DISMISS_MS : 4000);
""")
if text.count(old_schedule) != 1:
    raise RuntimeError("recovery scheduling changed unexpectedly")
text = text.replace(old_schedule, new_schedule)

old_overlay_call = dedent("""\
  showToast({
    message: "Overlay hidden; still watching.",
    actions: [{ label: "Undo", onClick: onUndo }],
    persistent: true,
    retainedRecovery: true,
  });
""")
new_overlay_call = dedent("""\
  showToast({
    message: "Overlay hidden; still watching.",
    actions: [{ label: "Undo", onClick: onUndo }],
    persistent: true,
    briefRecovery: true,
    timeoutMs: 0,
  });
""")
if text.count(old_overlay_call) != 1:
    raise RuntimeError("overlay cleanup toast call changed unexpectedly")
text = text.replace(old_overlay_call, new_overlay_call)
Path(ui).write_text(text, encoding="utf-8")

unit = "tests/overlay-cleanup-recovery-ui.test.ts"
replace_once(
    unit,
    '  return getRoot()?.querySelector<HTMLElement>(".wrap.retained-recovery") ?? null;\n',
    '  return getRoot()?.querySelector<HTMLElement>(".wrap.brief-recovery[data-persistent=\'true\']") ?? null;\n',
)
replace_once(
    unit,
    '    expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("false");\n',
    '    expect(getRecoveryCard()?.classList.contains("recovery-docked")).toBe(false);\n',
)
replace_once(
    unit,
    '    expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("false");\n',
    '    expect(getRecoveryCard()?.classList.contains("recovery-docked")).toBe(false);\n',
)
replace_once(
    unit,
    '    expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("true");\n    expect(getRecoveryCard()?.classList.contains("recovery-docked")).toBe(true);\n',
    '    expect(getRecoveryCard()?.classList.contains("recovery-docked")).toBe(true);\n',
)

nesting = Path("tests/e2e/overlay-cleanup-nesting.spec.ts")
nesting_text = nesting.read_text(encoding="utf-8")
attribute_blocks = [
    dedent("""\
    await expect(notice).toHaveAttribute("data-recovery-docked", "true");
    """),
    dedent("""\
    await expect(timedNotice).toHaveAttribute(
      "data-recovery-docked",
      "true",
      { timeout: 3000 },
    );
    """),
    dedent("""\
    await expect(notice).toHaveAttribute(
      "data-recovery-docked",
      "true",
      { timeout: 3000 },
    );
    """),
    dedent("""\
      await expect(recovery).toHaveAttribute(
        "data-recovery-docked",
        "true",
        { timeout: 3000 },
      );
    """),
]
class_blocks = [
    '    await expect(notice).toHaveClass(/recovery-docked/);\n',
    '    await expect(timedNotice).toHaveClass(/recovery-docked/, { timeout: 3000 });\n',
    '    await expect(notice).toHaveClass(/recovery-docked/, { timeout: 3000 });\n',
    '      await expect(recovery).toHaveClass(/recovery-docked/, { timeout: 3000 });\n',
]
for old, new in zip(attribute_blocks, class_blocks, strict=True):
    if nesting_text.count(old) != 1:
        raise RuntimeError(f"nesting recovery assertion changed: {old.splitlines()[0]}")
    nesting_text = nesting_text.replace(old, new)
nesting.write_text(nesting_text, encoding="utf-8")

phase2 = "tests/e2e/phase2-detections.spec.ts"
replace_once(
    phase2,
    dedent("""\
      await expect(recovery).toHaveAttribute(
        "data-recovery-docked",
        "true",
        { timeout: 3000 },
      );
    """),
    '      await expect(recovery).toHaveClass(/recovery-docked/, { timeout: 3000 });\n',
)

Path(".github/workflows/_compact-retained-recovery.yml").unlink()
Path("scripts/_compact_retained_recovery.py").unlink()
