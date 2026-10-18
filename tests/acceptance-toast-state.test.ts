// @vitest-environment happy-dom
// Acceptance polls match /block/i. After three blocks the card is gone and only
// a coalesced pill remains, so this reader has to see that pill.
import { beforeEach, describe, expect, it } from "vitest";
import { readToastState } from "./acceptance/toast_state_reader";

beforeEach(() => {
  document.body.innerHTML = "";
});

/** Pre-fix acceptance read: the first host's first `.body` only. */
function legacyFirstHostBody(): string | null {
  const host = document.querySelector("#__navsentinel_toast_host");
  const root = host?.shadowRoot;
  const text = root?.querySelector(".body")?.textContent?.trim() || null;
  return text;
}

function mountHost(): ShadowRoot {
  const host = document.createElement("div");
  host.id = "__navsentinel_toast_host";
  document.body.appendChild(host);
  return host.attachShadow({ mode: "open" });
}

function append(parent: ParentNode, tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

// happy-dom has no layout and no `offsetParent`. The visibility predicate treats
// a missing offset parent as hidden only when display is `none`, which is how a
// shadow-root button stays visible in Chromium.
function setOffsetParent(button: HTMLElement, parent: Element | null): void {
  Object.defineProperty(button, "offsetParent", {
    configurable: true,
    get: () => parent,
  });
}

describe("acceptance toast state reader", () => {
  it("returns { text: null, buttons: [] } when hosts are missing, shadowless, or blank", () => {
    expect(readToastState()).toEqual({ text: null, buttons: [] });
    expect(readToastState().text ?? "").not.toMatch(/block/i);

    const bare = document.createElement("div");
    bare.id = "__navsentinel_toast_host";
    document.body.appendChild(bare);
    expect(readToastState()).toEqual({ text: null, buttons: [] });

    const root = bare.attachShadow({ mode: "open" });
    append(root, "div", "body", "   ");
    append(root, "div", "pill idle", " \n ");
    append(root, "button", "", "Allow once");
    const state = readToastState();
    expect(state).toEqual({ text: null, buttons: [] });
    expect(state.text ?? "").not.toMatch(/block/i);
  });

  it("prefers a later full-card body over an earlier host's pill", () => {
    const earlier = mountHost();
    append(earlier, "div", "pill", "Heedline blocked 3 navigations");
    append(earlier, "button", "", "Decoy");

    const card = mountHost();
    append(card, "div", "body", "Heedline blocked a deceptive click");
    append(card, "button", "", "Allow once");

    expect(readToastState()).toEqual({
      text: "Heedline blocked a deceptive click",
      buttons: ["Allow once"],
    });
  });

  it("detects a lone idle coalesced pill that the first-host body reader misses", () => {
    const root = mountHost();
    append(root, "div", "body", "   ");
    append(root, "div", "pill idle", "Heedline blocked 4 navigations");

    expect(legacyFirstHostBody()).toBeNull();
    const state = readToastState();
    expect(state).toEqual({ text: "Heedline blocked 4 navigations", buttons: [] });
    expect(state.text ?? "").toMatch(/block/i);
  });

  it("observes a pill on the second host", () => {
    const first = mountHost();
    append(first, "div", "body", "  ");
    append(first, "button", "", "Stale");
    const second = mountHost();
    append(second, "div", "pill", "Heedline blocked 2 navigations");

    expect(legacyFirstHostBody()).toBeNull();
    const state = readToastState();
    expect(state).toEqual({ text: "Heedline blocked 2 navigations", buttons: [] });
    expect(state.buttons).not.toContain("Stale");
    expect(state.text ?? "").toMatch(/block/i);
  });

  it("keeps a full card's visible button text and filters display:none", () => {
    const root = mountHost();
    append(root, "div", "body", "Overlay hidden; still watching.");
    const visible = append(root, "button", "", "Undo");
    visible.style.display = "inline-block";
    setOffsetParent(visible, null);
    const hidden = append(root, "button", "", "Dismiss");
    hidden.style.display = "none";
    setOffsetParent(hidden, null);

    const state = readToastState();
    expect(state).toEqual({ text: "Overlay hidden; still watching.", buttons: ["Undo"] });
    expect(state.text ?? "").not.toMatch(/block/i);
  });
});
