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
});
