// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { scannableText } from "../extension/src/content/clickfix_detector";

// #1167 / #1218: what the ClickFix scan reads from the page.
describe("scannableText", () => {
  it("reads text inside open shadow roots", () => {
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).innerHTML = "<p>Press Win + R and paste</p>";
    const root = document.createElement("main");
    root.append("Verify you are human.", host);
    expect(scannableText(root, 5000)).toContain("Press Win + R and paste");
  });

  it("still skips script and style text, inside shadow roots too", () => {
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).innerHTML = "<style>p{color:red}</style><p>shown</p>";
    const root = document.createElement("main");
    root.innerHTML = "<script>var x = 'hidden code'</script><p>visible</p>";
    root.append(host);
    const text = scannableText(root, 5000);
    expect(text).toContain("visible");
    expect(text).toContain("shown");
    expect(text).not.toContain("hidden code");
    expect(text).not.toContain("color:red");
  });

  it("stops at the character cap", () => {
    const root = document.createElement("main");
    root.textContent = "x".repeat(10_000);
    expect(scannableText(root, 5000)).toHaveLength(5000);
    expect(scannableText(null, 5000)).toBe("");
  });

  it("stops visiting siblings once the cap is reached (lazy walk)", () => {
    const root = document.createElement("main");
    const first = document.createElement("p");
    first.textContent = "y".repeat(6000);
    root.append(first);
    let touched = 0;
    for (let i = 0; i < 2000; i++) {
      const el = document.createElement("span");
      Object.defineProperty(el, "shadowRoot", { get: () => { touched++; return null; } });
      root.append(el);
    }
    expect(scannableText(root, 5000)).toHaveLength(5000);
    expect(touched).toBe(0);
  });

  it("keeps light-DOM text in document order", () => {
    const root = document.createElement("main");
    root.innerHTML = "<p>one</p><div><span>two</span></div><p>three</p>";
    expect(scannableText(root, 5000).replace(/\s+/g, " ").trim()).toBe("one two three");
  });

  it("survives thousands of nested empty shadow roots without recursion (no fail-open)", () => {
    const root = document.createElement("main");
    let host: Element = root;
    for (let i = 0; i < 5000; i++) {
      const next = document.createElement("div");
      host.attachShadow({ mode: "open" }).append(next);
      host = next;
    }
    host.append("Press Win + R");
    expect(() => scannableText(root, 5000)).not.toThrow();
    expect(scannableText(root, 5000)).toContain("Press Win + R");
  });
});
