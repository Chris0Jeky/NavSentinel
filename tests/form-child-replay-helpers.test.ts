// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_CHILD_NAVIGABLE_SCAN,
  resolveChildNavigable,
  type ChildNavigableView,
} from "../extension/src/content/main_guard_helpers";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

function form(html: string): HTMLFormElement {
  document.body.innerHTML = html;
  return document.querySelector("form")!;
}

describe("resolveChildNavigable (#865)", () => {
  const sinkChild = { window: "sink" };
  const otherChild = { window: "other" };

  function view(
    overrides: Partial<ChildNavigableView> = {},
    names: Record<string, unknown> = { sink: sinkChild },
  ): ChildNavigableView {
    const children = [otherChild, sinkChild];
    return {
      selfName: "",
      lowercaseTarget: (target) => target.toLowerCase(),
      namedObject: (name) => names[name],
      childCount: children.length,
      child: (index) => children[index],
      ...overrides,
    };
  }

  it("returns the exact direct-child identity selected by the browser", () => {
    expect(resolveChildNavigable("sink", view())).toBe(sinkChild);
  });

  it("never treats keyword or empty targets as a child", () => {
    const everyName = view(
      {},
      { _self: sinkChild, _top: sinkChild, _parent: sinkChild, _blank: sinkChild, "": sinkChild },
    );
    for (const target of ["", "_self", "_top", "_parent", "_blank", "_TOP", "_Blank", "_SELF"]) {
      expect(resolveChildNavigable(target, everyName), target).toBeNull();
    }
  });

  it("prefers this context's own name over a child with the same name", () => {
    expect(resolveChildNavigable("sink", view({ selfName: "sink" }))).toBeNull();
  });

  it("rejects missing names and named objects that are not indexed children", () => {
    expect(resolveChildNavigable("missing", view())).toBeNull();
    expect(resolveChildNavigable("sink", view({}, { sink: { tagName: "IFRAME" } }))).toBeNull();
  });

  it("keeps ordinary browsing-context names case-sensitive", () => {
    expect(resolveChildNavigable("Sink", view())).toBeNull();
  });

  it("lets the caller compare the same child before and after formdata", () => {
    const before = resolveChildNavigable("sink", view());
    expect(before).toBe(sinkChild);
    expect(resolveChildNavigable("sink", view())).toBe(before);
    expect(resolveChildNavigable("sink", view({}, { sink: otherChild }))).not.toBe(before);
  });

  it("bounds the identity scan and ignores invalid child counts", () => {
    let reads = 0;
    expect(
      resolveChildNavigable(
        "sink",
        view({
          childCount: Number.MAX_SAFE_INTEGER,
          child: () => {
            reads += 1;
            return undefined;
          },
        }),
      ),
    ).toBeNull();
    expect(reads).toBe(MAX_CHILD_NAVIGABLE_SCAN);

    reads = 0;
    expect(resolveChildNavigable("sink", view({ childCount: Number.NaN, child: () => ++reads }))).toBeNull();
    expect(reads).toBe(0);
  });
});
