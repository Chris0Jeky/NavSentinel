/**
 * Select the segment whose `data-value` equals `value`. The value comes from
 * storage and may be hostile, so it is typed `unknown`: a non-string or
 * unmatched value selects `fallback` (the safe default) rather than the first
 * segment, which for a mode control is "Off" (#866). Matching is exact, the
 * same rule enforcement applies.
 */
export function setSegValue(seg: HTMLDivElement, value: unknown, fallback = "smart"): void {
  const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".seg-btn"));
  const values = btns.map((btn) => btn.dataset.value);
  const selected = typeof value === "string" && values.includes(value)
    ? value
    : values.includes(fallback) ? fallback : values[0];
  for (const btn of btns) {
    const active = selected !== undefined && btn.dataset.value === selected;
    btn.setAttribute("aria-checked", String(active));
    btn.setAttribute("tabindex", active ? "0" : "-1");
  }
}

export function getSegValue(seg: HTMLDivElement): string {
  for (const btn of Array.from(seg.querySelectorAll<HTMLButtonElement>(".seg-btn"))) {
    if (btn.getAttribute("aria-checked") === "true") return btn.dataset.value ?? "smart";
  }
  return "smart";
}

export function initSegKeyboard(seg: HTMLDivElement): void {
  seg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".seg-btn"));
    const idx = btns.indexOf(e.target as HTMLButtonElement);
    if (idx < 0) return;
    e.preventDefault();
    const next = e.key === "ArrowRight"
      ? btns[(idx + 1) % btns.length]!
      : btns[(idx - 1 + btns.length) % btns.length]!;
    next.focus();
    if (next.getAttribute("aria-checked") !== "true") {
      next.click();
    }
  });
}
