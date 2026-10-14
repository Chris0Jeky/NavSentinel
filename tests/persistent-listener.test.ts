// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

// #1105: document.open() erases listeners; the helper re-adds them. happy-dom
// has no document.open() listener erasure, so the test erases by hand and
// replaces the document element, the mutation document.open() makes.
async function load() {
  vi.resetModules();
  return (await import("../extension/src/content/persistent_listener")).addPersistentListener;
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function replaceRoot(): void {
  document.documentElement.remove();
  document.appendChild(document.createElement("html"));
}

function submit(): void {
  document.dispatchEvent(new Event("submit", { bubbles: true }));
}

describe("addPersistentListener", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<body></body>";
  });

  it("re-adds the listener once the document's children are replaced, without double firing", async () => {
    const add = await load();
    const listener = vi.fn();
    add(document, "submit", listener);
    submit();
    expect(listener).toHaveBeenCalledTimes(1);

    document.removeEventListener("submit", listener, true); // what document.open() does
    submit();
    expect(listener).toHaveBeenCalledTimes(1);

    replaceRoot();
    await tick();
    await tick();
    submit();
    expect(listener).toHaveBeenCalledTimes(2);

    // A second replacement while the listener is still attached must not stack it.
    replaceRoot();
    await tick();
    await tick();
    submit();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("re-adds after an added-only record on an already childless document", async () => {
    const add = await load();
    const listener = vi.fn();
    add(document, "submit", listener);
    document.replaceChildren(); // childless: the later open() queues no removal
    await tick();
    await tick();

    document.removeEventListener("submit", listener, true); // document.open() on the childless document
    document.appendChild(document.createElement("html")); // the write: addedNodes only
    await tick();
    await tick();
    submit();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not touch listeners on ordinary DOM mutations", async () => {
    const add = await load();
    add(document, "submit", vi.fn());
    const spy = vi.spyOn(document, "addEventListener");
    document.body.appendChild(document.createElement("form"));
    document.body.innerHTML = "<p>x</p>";
    await tick();
    await tick();
    expect(spy).not.toHaveBeenCalled();
  });

  it("shares one observer across registrations and also re-adds window listeners", async () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const add = await load();
    const onDoc = vi.fn();
    const onWindow = vi.fn();
    add(document, "paste", onDoc);
    add(window, "submit", onWindow);
    expect(observe).toHaveBeenCalledTimes(1);

    document.removeEventListener("paste", onDoc, true);
    window.removeEventListener("submit", onWindow, true);
    replaceRoot();
    await tick();
    await tick();
    document.dispatchEvent(new Event("paste"));
    window.dispatchEvent(new Event("submit"));
    expect(onDoc).toHaveBeenCalledTimes(1);
    expect(onWindow).toHaveBeenCalledTimes(1);
    observe.mockRestore();
  });
});
