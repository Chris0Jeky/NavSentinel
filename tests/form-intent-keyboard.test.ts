// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { implicitSubmitBinding } from "../extension/src/content/form_intent";

function captureBinding(target: Element, init: KeyboardEventInit) {
  let binding: ReturnType<typeof implicitSubmitBinding> = null;
  target.addEventListener("keydown", event => {
    binding = implicitSubmitBinding(event as KeyboardEvent);
  }, { once: true });
  target.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    composed: true,
    ...init,
  }));
  return binding;
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("implicit keyboard form authority (#688)", () => {
  it("binds Enter on a text field to its owner form without inventing a submitter", () => {
    document.body.innerHTML = '<form id="f" action="https://sink.test/accept" method="post" target="_top"><input id="q" name="q"></form>';
    const form = document.querySelector<HTMLFormElement>("#f")!;
    const input = document.querySelector<HTMLInputElement>("#q")!;

    const binding = captureBinding(input, { key: "Enter" });

    expect(binding).not.toBeNull();
    expect(binding?.form).toBe(form);
    expect(binding?.submitter).toBeNull();
    expect(binding?.intent).toEqual([
      "https://sink.test/accept",
      "post",
      "application/x-www-form-urlencoded",
      "_top",
      "self",
    ]);
  });

  it("supports form-associated text fields outside the form", () => {
    document.body.innerHTML = '<form id="f" action="https://sink.test/accept" target="_top"></form><input id="q" form="f">';
    const form = document.querySelector<HTMLFormElement>("#f")!;
    const input = document.querySelector<HTMLInputElement>("#q")!;

    const binding = captureBinding(input, { key: "Enter" });

    expect(binding?.form).toBe(form);
    expect(binding?.submitter).toBeNull();
  });

  it("defers to the existing trusted-click path when a submit control exists", () => {
    document.body.innerHTML = '<form action="https://sink.test/accept" target="_top"><input id="q"><button>Submit</button></form>';
    expect(captureBinding(document.querySelector("#q")!, { key: "Enter" })).toBeNull();
  });

  it("does not grant authority when native implicit submission is blocked by multiple text fields", () => {
    document.body.innerHTML = '<form action="https://sink.test/accept" target="_top"><input id="q"><input name="second"></form>';
    expect(captureBinding(document.querySelector("#q")!, { key: "Enter" })).toBeNull();
  });

  it.each([
    ["another key", '<input id="q">', { key: "a" }],
    ["composition", '<input id="q">', { key: "Enter", isComposing: true }],
    ["Alt+Enter", '<input id="q">', { key: "Enter", altKey: true }],
    ["Control+Enter", '<input id="q">', { key: "Enter", ctrlKey: true }],
    ["button input", '<input id="q" type="button">', { key: "Enter" }],
    ["textarea", '<textarea id="q"></textarea>', { key: "Enter" }],
  ] as const)("does not mint authority for %s", (_name, control, init) => {
    document.body.innerHTML = `<form id="f" action="https://sink.test/accept" target="_top">${control}</form>`;
    const target = document.querySelector<Element>("#q")!;

    expect(captureBinding(target, init)).toBeNull();
  });
});
