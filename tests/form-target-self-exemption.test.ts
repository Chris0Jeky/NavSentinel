// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import ts from "typescript";
import { readCapturedFormTarget } from "../extension/src/content/main_guard_helpers";

/**
 * #1055: the subframe self-exemption must not trust the live `form.target`
 * getter. A page can replace it with a getter that returns "" and make a
 * `target=_top` submit look like a self submit.
 */
describe("readCapturedFormTarget (#1055)", () => {
  const original = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, "target");

  afterEach(() => {
    if (original) Object.defineProperty(HTMLFormElement.prototype, "target", original);
    else delete (HTMLFormElement.prototype as unknown as { target?: unknown }).target;
  });

  it("reads _top from the captured getter after the live getter returns empty", () => {
    const form = document.createElement("form");
    form.setAttribute("target", "_top");
    function captured(this: HTMLFormElement): string {
      return this.getAttribute("target") ?? "";
    }
    Object.defineProperty(HTMLFormElement.prototype, "target", {
      configurable: true,
      get: captured,
    });
    Object.defineProperty(HTMLFormElement.prototype, "target", {
      configurable: true,
      get() {
        return "";
      },
    });

    expect(form.target).toBe("");
    expect(readCapturedFormTarget(form, captured)).toBe("_top");
  });

  it("returns an empty string only when the captured getter reports no target", () => {
    const form = document.createElement("form");
    function captured(this: HTMLFormElement): string {
      return this.getAttribute("target") ?? "";
    }
    expect(readCapturedFormTarget(form, captured)).toBe("");
  });

  it("returns null when the captured getter is missing, throws, or returns a non-string", () => {
    const form = document.createElement("form");
    form.setAttribute("target", "_top");
    expect(readCapturedFormTarget(form, undefined)).toBeNull();
    expect(readCapturedFormTarget(form, () => {
      throw new Error("replaced");
    })).toBeNull();
    expect(readCapturedFormTarget(form, () => 0 as unknown as string)).toBeNull();
  });
});

describe("dispatchFormSubmit self-exemption (#1055)", () => {
  const guard = readFileSync(resolve("extension/src/content/main_guard.ts"), "utf8");

  it("passes the startup-captured target getter into the self-exemption", () => {
    const source = ts.createSourceFile("main_guard.ts", guard, ts.ScriptTarget.Latest, true);
    const dispatch = source.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "dispatchFormSubmit");
    expect(dispatch).toBeDefined();

    const selfChecks: ts.CallExpression[] = [];
    const reads: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === "isFormSelfTarget") selfChecks.push(node);
        if (node.expression.text === "readCapturedFormTarget") reads.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(dispatch!);

    expect(selfChecks).toHaveLength(1);
    const argument = selfChecks[0]!.arguments[0];
    expect(argument && ts.isIdentifier(argument) && argument.text === "capturedFormTarget").toBe(true);
    expect(reads).toHaveLength(1);
    expect(reads[0]!.arguments.map((arg) => ts.isIdentifier(arg) ? arg.text : "")).toEqual([
      "form",
      "nativeFormTargetGetter",
    ]);

    const init = guard.indexOf("const earlyFormTarget = ");
    const dispatchAt = guard.indexOf("function dispatchFormSubmit(");
    expect(init).toBeGreaterThanOrEqual(0);
    expect(init).toBeLessThan(dispatchAt);
    const binding = guard.slice(init, init + 520);
    expect(binding).toContain("__navsentinelMainFormTarget");
    expect(binding).toContain("typeof earlyFormTarget === \"function\"");
    expect(binding.indexOf("__navsentinelMainFormTarget")).toBeLessThan(
      binding.indexOf("nativeGetOwnPropertyDescriptor"),
    );
    expect(guard.slice(dispatchAt, guard.indexOf("function patchForms("))).not.toContain("form.target");
  });
});
