from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement anchor, found {count}")
    target.write_text(text.replace(old, new), encoding="utf-8")


replace_once(
    "extension/src/content/ui_toast.ts",
    ".pill{display:flex;",
    ".pill{pointer-events:auto;display:flex;",
)

replace_once(
    "tests/ui-toast-coalesce.test.ts",
    '''  it("expands to a full card with the earlier-count on click", () => {
''',
    '''  it("keeps the count pill targetable while the host passes through page input", () => {
    block();
    block();
    block();

    const host = document.documentElement.querySelector<HTMLElement>(
      "#__navsentinel_toast_host",
    );
    const css = getRoot()?.querySelector("style")?.textContent ?? "";

    expect(host?.style.pointerEvents).toBe("none");
    expect(css).toContain(".pill{pointer-events:auto;");
  });

  it("expands to a full card with the earlier-count on click", () => {
''',
)

Path(".github/workflows/_apply-toast-pill-pointer-fix.yml").unlink()
Path("scripts/_apply_toast_pill_pointer_fix.py").unlink()
