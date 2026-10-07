import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import { EARLY_MAIN_PRELUDE } from "../../scripts/content-loader-contract.mjs";

type Mutation = "none" | "own call" | "prototype call" | "Reflect.apply" | "all dispatch methods";
type Phase = "before module" | "after module";
type ProbeInput = { prelude: string; helperModule: string; mutation: Mutation; phase: Phase };

// Actual native DOM getters/methods and the production loader/helper bytes.
// No extension is loaded, no form is submitted, and no navigation is attempted.
// This isolates the invocation boundary, not end-to-end protection or Gate-3.
export function probeNativeReaders({ prelude, helperModule, mutation, phase }: ProbeInput) {
  const form = document.createElement("form");
  form.setAttribute("target", "_top");
  form.setAttribute("action", "https://receiver.example/post");
  form.setAttribute("method", "post");
  const anchor = document.createElement("a");
  const button = document.createElement("span");
  anchor.append(button);
  document.body.append(form, anchor);

  const targetGetter = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, "target")!.get!;
  const getAttribute = Element.prototype.getAttribute;
  const closest = Element.prototype.closest;
  const originalApply = Reflect.apply;
  const properties: [object, string][] = [
    [targetGetter, "call"], [getAttribute, "call"], [closest, "call"], [originalApply, "call"],
    [Function.prototype, "call"], [Function.prototype, "apply"], [Function.prototype, "bind"],
    [Reflect, "apply"], [Element.prototype, "getAttribute"], [Element.prototype, "closest"],
    [HTMLFormElement.prototype, "target"],
  ];
  const saved = properties.map(([object, key]) => ({ object, key, descriptor: Object.getOwnPropertyDescriptor(object, key) }));
  const readers = {} as {
    readCapturedFormTarget(form: HTMLFormElement, getter: typeof targetGetter): string | null;
    readCapturedAttribute(element: Element, name: string, reader: typeof getAttribute): string | null | undefined;
    readCapturedClosest(element: Element, selector: string, reader: typeof closest): Element | null | undefined;
  };
  // Compile both before poisoning dispatch methods; execute the helper module
  // on the selected side of the import gap. Its reads use the page realm.
  const loadPrelude = new Function(prelude);
  const loadHelpers = new Function("exports", helperModule);
  function replace(object: object, key: string, value: unknown): void {
    Object.defineProperty(object, key, { value, configurable: true, writable: true });
  }
  function tamper(): void {
    if (mutation === "none") return;
    Object.defineProperty(HTMLFormElement.prototype, "target", { configurable: true, get: () => "" });
    replace(Element.prototype, "getAttribute", () => null);
    replace(Element.prototype, "closest", () => null);
    if (mutation === "own call" || mutation === "all dispatch methods") {
      replace(targetGetter, "call", () => "");
      replace(getAttribute, "call", () => null);
      replace(closest, "call", () => null);
    }
    if (mutation === "prototype call" || mutation === "all dispatch methods") {
      replace(Function.prototype, "call", () => null);
    }
    if (mutation === "Reflect.apply" || mutation === "all dispatch methods") {
      replace(Reflect, "apply", () => null);
      replace(originalApply, "call", () => null);
    }
    if (mutation === "all dispatch methods") {
      replace(Function.prototype, "apply", () => null);
      replace(Function.prototype, "bind", () => null);
    }
  }
  try {
    loadPrelude();
    if (phase === "before module") tamper();
    loadHelpers(readers);
    if (phase === "after module") tamper();
    const result = {
      target: readers.readCapturedFormTarget(form, targetGetter),
      action: readers.readCapturedAttribute(form, "action", getAttribute),
      method: readers.readCapturedAttribute(form, "method", getAttribute),
      ancestorMatches: readers.readCapturedClosest(button, "a", closest) === anchor,
      absentAttribute: readers.readCapturedAttribute(form, "missing", getAttribute),
      unmatchedAncestor: readers.readCapturedClosest(button, "form", closest),
      emptyTarget: "pending" as string | null,
    };
    form.setAttribute("target", "");
    result.emptyTarget = readers.readCapturedFormTarget(form, targetGetter);
    return result;
  } finally {
    // Never leave a poisoned Playwright page or host runtime behind. The early
    // immutable captures remain only in this disposable test page.
    for (const { object, key, descriptor } of saved) {
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else Reflect.deleteProperty(object, key);
    }
    form.remove();
    anchor.remove();
  }
}

const helperSource = readFileSync("extension/src/content/main_guard_helpers.ts", "utf8");
const helperModule = ts.transpileModule(helperSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const expected = {
  target: "_top", action: "https://receiver.example/post", method: "post", ancestorMatches: true,
  absentAttribute: null, unmatchedAncestor: null, emptyTarget: "",
};

for (const phase of ["before module", "after module"] as const) {
  for (const mutation of ["none", "own call", "prototype call", "Reflect.apply", "all dispatch methods"] as const) {
    test(`captured native readers survive ${mutation} ${phase} @regression`, async ({ page, context, browser }, testInfo) => {
      const attempts: string[] = [];
      await context.route("**/*", async route => {
        attempts.push(route.request().url());
        await route.abort();
      });
      const result = await page.evaluate(probeNativeReaders, { prelude: EARLY_MAIN_PRELUDE, helperModule, mutation, phase });
      await testInfo.attach("native-reader-invocation.json", {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify({ schema: "navsentinel.native-reader-invocation.v1", phase, mutation,
          browserVersion: browser.version(), helperSha256: createHash("sha256").update(helperSource).digest("hex"),
          preludeSha256: createHash("sha256").update(EARLY_MAIN_PRELUDE).digest("hex"), result, attempts })),
      });
      expect(result).toEqual(expected);
      expect(attempts).toEqual([]);
      expect(page.url()).toBe("about:blank");
    });
  }
}
