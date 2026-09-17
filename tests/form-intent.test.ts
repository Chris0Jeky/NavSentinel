// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { FormAttemptGate, formBindingUnchanged, resolveFormIntent, validateFormReceiver } from "../extension/src/content/form_intent";
import { FORM_INTENT_TTL_MS, formDestinationMatches, isFormIntent, sameFormIntent, type FormIntent } from "../extension/src/shared/form_intent";

const ID = "a".repeat(32);
function fixture() {
  document.body.innerHTML = '<form id="f" action="/accept?old=1" method="post" target="_top"><button id="b">Submit</button></form><form id="g"></form>';
  const form = document.querySelector<HTMLFormElement>("#f")!;
  const submitter = document.querySelector<HTMLButtonElement>("#b")!;
  const intent = resolveFormIntent(form, submitter)!;
  return { form, submitter, intent };
}
beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = ""; });

describe("effective form destination (#688)", () => {
  it("resolves a nonempty action against document.baseURI, not location", () => {
    const b = fixture();
    document.head.innerHTML = '<base href="https://base.test/dir/">';
    b.form.setAttribute("action", "result");
    expect(resolveFormIntent(b.form)?.[0]).toBe("https://base.test/dir/result");
  });
  it.each([null, ""])("missing/empty action %s uses the document URL, not base", value => {
    const b = fixture(); document.head.innerHTML = '<base href="https://base.test/dir/">';
    if (value === null) b.form.removeAttribute("action"); else b.form.setAttribute("action", value);
    expect(resolveFormIntent(b.form)?.[0]).toBe(document.URL);
  });
  it("an empty submitter action overrides a nonempty form action", () => {
    const b = fixture(); b.submitter.setAttribute("formaction", "");
    expect(resolveFormIntent(b.form, b.submitter)?.[0]).toBe(document.URL);
  });
  it.each(["", "invalid", "POST ", " patch "])("invalid/empty formmethod %s means GET, not inherited POST", value => {
    const b = fixture(); b.submitter.setAttribute("formmethod", value);
    expect(resolveFormIntent(b.form, b.submitter)?.[1]).toBe("get");
  });
  it("missing method override inherits; valid values are case insensitive", () => {
    const b = fixture(); expect(b.intent[1]).toBe("post");
    b.submitter.setAttribute("formmethod", "DiAlOg");
    expect(resolveFormIntent(b.form, b.submitter)?.[1]).toBe("dialog");
  });
  it.each(["", "garbage"])("invalid/empty enctype %s uses urlencoded instead of inherited multipart", value => {
    const b = fixture(); b.form.enctype = "multipart/form-data"; b.submitter.setAttribute("formenctype", value);
    expect(resolveFormIntent(b.form, b.submitter)?.[2]).toBe("application/x-www-form-urlencoded");
  });
  it("binds a valid submitter enctype override", () => {
    const b = fixture(); b.submitter.setAttribute("formenctype", "text/plain");
    expect(resolveFormIntent(b.form, b.submitter)?.[2]).toBe("text/plain");
  });
  it("empty formtarget is self, even with a hostile form/base target", () => {
    const b = fixture(); document.head.innerHTML = '<base target="_blank">'; b.submitter.setAttribute("formtarget", "");
    expect(resolveFormIntent(b.form, b.submitter)?.slice(3)).toEqual(["", "self"]);
  });
  it("only missing targets inherit the first base[target]", () => {
    const b = fixture(); b.form.removeAttribute("target"); document.head.innerHTML = '<base target="_blank"><base target="_top">';
    expect(resolveFormIntent(b.form, b.submitter)?.[3]).toBe("_blank");
    b.form.setAttribute("target", ""); expect(resolveFormIntent(b.form, b.submitter)?.[4]).toBe("self");
  });
  it("sanitizes dangling-markup target names as the browser does", () => {
    const b = fixture(); b.submitter.setAttribute("formtarget", "bad\n<target");
    expect(resolveFormIntent(b.form, b.submitter)?.[3]).toBe("_blank");
    expect(resolveFormIntent(b.form, b.submitter)?.[4]).toBe("other");
  });
  it("does not read clobberable form.action/method/target properties", () => {
    const b = fixture(); b.form.insertAdjacentHTML("beforeend", '<input name="action"><input name="method"><input name="target">');
    expect(resolveFormIntent(b.form, b.submitter)).toEqual(b.intent);
  });
  it("rejects an unparseable action without falling back to another destination", () => {
    const b = fixture(); b.submitter.setAttribute("formaction", "http://[");
    expect(resolveFormIntent(b.form, b.submitter)).toBeNull();
  });
  it("preserves native argument error classes before any authority decision", () => {
    const b = fixture(); const other = document.querySelector<HTMLFormElement>("#g")!;
    expect(() => validateFormReceiver(b.form, document.body)).toThrow(TypeError);
    b.submitter.type = "button";
    expect(() => validateFormReceiver(b.form, b.submitter)).toThrow(TypeError);
    b.submitter.type = "submit"; other.append(b.submitter);
    try { validateFormReceiver(b.form, b.submitter); throw new Error("missing error"); }
    catch (error) { expect((error as DOMException).name).toBe("NotFoundError"); }
    expect(() => validateFormReceiver(b.form, null)).not.toThrow();
  });
});

describe("DOM-bound first-attempt authority (#688)", () => {
  function armed() {
    const binding = fixture(); const gate = new FormAttemptGate(); gate.capture(binding, 10, 0);
    expect(gate.authorize(ID, binding.intent, 10, 0)).toBe(true);
    return { ...binding, gate };
  }
  it.each(["request", "submit"])("permits exact %s once", kind => {
    const b = armed(); const submitter = kind === "request" ? b.submitter : null;
    expect(b.gate.consume(b.form, submitter, b.intent, 100).allowed).toBe(true);
    expect(b.gate.consume(b.form, submitter, b.intent, 101).allowed).toBe(false);
    expect(b.gate.authorize(ID, b.intent, 10, 102)).toBe(false);
  });
  it("same-URL alternate submitter burns the grant and cannot be retried", () => {
    const b = armed(); const second = document.createElement("button"); b.form.append(second);
    expect(b.gate.consume(b.form, second, b.intent, 100).allowed).toBe(false);
    expect(b.gate.consume(b.form, b.submitter, b.intent, 101).allowed).toBe(false);
  });
  it("same-URL alternate form is not the clicked form", () => {
    const b = armed(); const other = document.querySelector<HTMLFormElement>("#g")!;
    expect(b.gate.consume(other, null, b.intent, 100).allowed).toBe(false);
  });
  it.each([
    ["formaction", "https://elsewhere.test/"], ["formmethod", "get"],
    ["formenctype", "text/plain"], ["formtarget", "_blank"],
  ])("changing submitter %s invalidates replay and first use", (name, value) => {
    const b = armed(); b.submitter.setAttribute(name, value);
    expect(formBindingUnchanged(b)).toBe(false);
    const current = resolveFormIntent(b.form, b.submitter)!;
    expect(b.gate.consume(b.form, b.submitter, current, 100).allowed).toBe(false);
    b.submitter.removeAttribute(name);
    expect(b.gate.consume(b.form, b.submitter, b.intent, 101).allowed).toBe(false);
  });
  it.each(["href", "target"])("late base %s mutation invalidates captured intent", attribute => {
    const b = fixture(); b.form.setAttribute("action", "relative"); b.form.removeAttribute("target");
    document.head.innerHTML = '<base href="https://base.test/start/" target="_self">';
    const binding = { ...b, intent: resolveFormIntent(b.form, b.submitter)! };
    document.querySelector("base")!.setAttribute(attribute, attribute === "href" ? "https://changed.test/" : "_top");
    expect(formBindingUnchanged(binding)).toBe(false);
  });
  it("submitter reassociation and disconnected forms invalidate a replay closure", () => {
    const b = armed(); document.querySelector("#g")!.append(b.submitter);
    expect(formBindingUnchanged(b)).toBe(false);
    b.form.append(b.submitter); b.form.remove(); expect(formBindingUnchanged(b)).toBe(false);
  });
  it("expires at the exact deadline, and duplicate approval cannot extend it", () => {
    const b = armed(); expect(b.gate.authorize(ID, b.intent, 10, 1000)).toBe(false);
    expect(b.gate.consume(b.form, b.submitter, b.intent, FORM_INTENT_TTL_MS).allowed).toBe(false);
  });
  it("a late approval packet cannot revive a native attempt or a newer click", () => {
    const b = armed(); b.gate.clear();
    expect(b.gate.authorize(ID, b.intent, 10, 20)).toBe(false);
    b.gate.capture(b, 30, 20);
    expect(b.gate.authorize(ID, b.intent, 10, 25)).toBe(false);
  });
  it("captures no request body or field values", () => {
    const b = fixture(); b.form.insertAdjacentHTML("beforeend", '<input type="password" value="never-serialize-me">');
    expect(JSON.stringify(resolveFormIntent(b.form, b.submitter))).not.toContain("never-serialize-me");
    expect(b.intent).toHaveLength(5);
  });
});

describe("worker-visible effective destination semantics (#688)", () => {
  const intent: FormIntent = ["https://sink.test/accept?old=1", "post", "application/x-www-form-urlencoded", "_top", "top"];
  it("GET replaces an existing query while POST retains it", () => {
    expect(formDestinationMatches([intent[0], "get", intent[2], intent[3], intent[4]], "https://sink.test/accept?field=2")).toBe(true);
    expect(formDestinationMatches(intent, "https://sink.test/accept?field=2")).toBe(false);
    expect(formDestinationMatches(intent, "https://sink.test/accept?old=1#fragment")).toBe(true);
    expect(formDestinationMatches(intent, "https://other.test/accept?old=1")).toBe(false);
  });
  it("binds every metadata field, not just the action URL", () => {
    expect(sameFormIntent(intent, [...intent])).toBe(true);
    for (const changed of [
      [intent[0], "get", intent[2], intent[3], intent[4]],
      [intent[0], intent[1], "text/plain", intent[3], intent[4]],
      [intent[0], intent[1], intent[2], "_self", intent[4]],
      [intent[0], intent[1], intent[2], intent[3], "self"],
    ] as FormIntent[]) expect(sameFormIntent(intent, changed)).toBe(false);
  });
  it("rejects malformed bridge/session metadata", () => {
    expect(isFormIntent(intent)).toBe(true);
    for (const bad of [null, [], [intent[0], "PATCH", intent[2], intent[3], intent[4]], [intent[0], intent[1], intent[2], intent[3], intent[4], "extra"], ["not a URL", intent[1], intent[2], intent[3], intent[4]]]) expect(isFormIntent(bad)).toBe(false);
  });
});
