/**
 * Serializable toast read for `page.evaluate(readToastState)`.
 * Must not close over imports. The first nonempty `.body` in host order wins,
 * using each host's first `.body` as the existing card read does. Otherwise the
 * first nonempty `.pill` wins, and `.pill` includes `.pill.idle`. Buttons come
 * only from that host and keep the original visibility predicate. No notice
 * stays `{ text: null, buttons: [] }`.
 */
export function readToastState(): { text: string | null; buttons: string[] } {
  const hosts = document.querySelectorAll("#__navsentinel_toast_host");
  let bodyChoice: { root: ShadowRoot; text: string } | null = null;
  let pillChoice: { root: ShadowRoot; text: string } | null = null;

  for (const host of Array.from(hosts)) {
    const root = host.shadowRoot;
    if (!root) continue;
    if (!bodyChoice) {
      const bodyText = root.querySelector(".body")?.textContent?.trim() ?? "";
      if (bodyText) bodyChoice = { root, text: bodyText };
    }
    if (!pillChoice) {
      const pillText = root.querySelector(".pill")?.textContent?.trim() ?? "";
      if (pillText) pillChoice = { root, text: pillText };
    }
  }

  const choice = bodyChoice ?? pillChoice;
  if (!choice) return { text: null, buttons: [] };

  const buttons = Array.from(choice.root.querySelectorAll("button"))
    .filter((button) => button.offsetParent !== null || getComputedStyle(button).display !== "none")
    .map((button) => button.textContent?.trim() ?? "");
  return { text: choice.text, buttons };
}
