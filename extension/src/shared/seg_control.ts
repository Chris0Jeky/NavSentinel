export function setSegValue(seg: HTMLDivElement, value: string): void {
  let matched = false;
  for (const btn of Array.from(seg.querySelectorAll<HTMLButtonElement>(".seg-btn"))) {
    const active = btn.dataset.value === value.toLowerCase();
    if (active) matched = true;
    btn.setAttribute("aria-checked", String(active));
    btn.setAttribute("tabindex", active ? "0" : "-1");
  }
  if (!matched) {
    const first = seg.querySelector<HTMLButtonElement>(".seg-btn");
    if (first) {
      first.setAttribute("aria-checked", "true");
      first.setAttribute("tabindex", "0");
    }
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
