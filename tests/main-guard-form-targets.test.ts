// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_CHILD_NAVIGABLE_SCAN,
  effectiveFormTarget,
  targetsChildNavigable,
  type ChildNavigableView,
} from "../extension/src/content/main_guard_helpers";

// #865: a form posted into the page's own named iframe never navigates the tab.
// The MAIN-world wrapper feeds these helpers from captured natives; the browser
// facts they encode (self name first, current child names, keyword targets)
// were measured on Chromium and are exercised end to end by
// tests/e2e/form-submit-gesture-task.spec.ts.

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

function form(html: string): HTMLFormElement {
  document.body.innerHTML = html;
  return document.querySelector("form")!;
}

describe("effectiveFormTarget (#865)", () => {
  it("uses the form target attribute", () => {
    expect(effectiveFormTarget(form(`<form target="sink"></form>`))).toBe("sink");
  });

  it("lets the submitter's formtarget override the form, even when empty", () => {
    const f = form(`<form target="sink"><button formtarget="other">a</button><button formtarget="">b</button></form>`);
    const [other, empty] = Array.from(f.querySelectorAll("button"));
    expect(effectiveFormTarget(f, other)).toBe("other");
    expect(effectiveFormTarget(f, empty)).toBe("");
    expect(effectiveFormTarget(f, null)).toBe("sink");
  });

  it("falls back to the first <base target> only when the form has no target attribute", () => {
    document.head.innerHTML = `<base target="first"><base target="second">`;
    expect(effectiveFormTarget(form(`<form></form>`))).toBe("first");
    expect(effectiveFormTarget(form(`<form target=""></form>`))).toBe("");
  });

  it("is empty (this browsing context) with no target anywhere", () => {
    expect(effectiveFormTarget(form(`<form></form>`))).toBe("");
  });
});

describe("targetsChildNavigable (#865)", () => {
  const sinkChild = { window: "sink" };
  const otherChild = { window: "other" };
  function view(overrides: Partial<ChildNavigableView> = {}, names: Record<string, unknown> = { sink: sinkChild }): ChildNavigableView {
    const children = [otherChild, sinkChild];
    return {
      selfName: "",
      namedObject: (name) => names[name],
      childCount: children.length,
      child: (index) => children[index],
      ...overrides,
    };
  }

  it("accepts a name the browser resolves to a direct child navigable", () => {
    expect(targetsChildNavigable("sink", view())).toBe(true);
  });

  it("never treats keyword or empty targets as a child", () => {
    const everyName = view({}, { _self: sinkChild, _top: sinkChild, _parent: sinkChild, _blank: sinkChild, "": sinkChild });
    for (const target of ["", "_self", "_top", "_parent", "_blank", "_TOP", "_Blank", "_SELF"]) {
      expect(targetsChildNavigable(target, everyName), target).toBe(false);
    }
  });

  it("prefers this context's own name, because the browser checks it first", () => {
    expect(targetsChildNavigable("sink", view({ selfName: "sink" }))).toBe(false);
  });

  it("rejects a name nothing answers to (the browser opens a new window)", () => {
    expect(targetsChildNavigable("missing", view())).toBe(false);
  });

  it("rejects a named object that is not one of the indexed children", () => {
    // An element with that id/name, or a page alias to some other window.
    const element = { tagName: "DIV" };
    expect(targetsChildNavigable("sink", view({}, { sink: element }))).toBe(false);
  });

  it("is case-sensitive for ordinary names", () => {
    expect(targetsChildNavigable("Sink", view())).toBe(false);
  });

  it("bounds the identity scan even when the reported child count is huge", () => {
    let reads = 0;
    const result = targetsChildNavigable("sink", view({
      childCount: Number.MAX_SAFE_INTEGER,
      child: () => {
        reads += 1;
        return undefined;
      },
    }));
    expect(result).toBe(false);
    expect(reads).toBe(MAX_CHILD_NAVIGABLE_SCAN);
  });
});
