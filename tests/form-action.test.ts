import { describe, expect, it } from "vitest";
import { resolveFormActionUrl } from "../extension/src/content/form_action";

const DOC = "https://app.example/page?x=1";
const BASE = "https://app.example/page?x=1";

describe("resolveFormActionUrl base-URL binding (#650)", () => {
  it("resolves a relative action against document.baseURI, not location.href", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: null,
        formAction: "submit",
        baseURI: "https://cdn.example/base/path/",
        documentURL: DOC,
      }),
    ).toBe("https://cdn.example/base/path/submit");
  });

  it("resolves a root-relative action against the base origin", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: null,
        formAction: "/login",
        baseURI: "https://cdn.example/base/path/",
        documentURL: DOC,
      }),
    ).toBe("https://cdn.example/login");
  });

  it("ignores the base for absolute http(s) actions", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: null,
        formAction: "https://other.example/submit",
        baseURI: "https://cdn.example/base/",
        documentURL: DOC,
      }),
    ).toBe("https://other.example/submit");
  });

  it("resolves protocol-relative actions against the base scheme", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: null,
        formAction: "//other.example/submit",
        baseURI: "https://cdn.example/base/",
        documentURL: DOC,
      }),
    ).toBe("https://other.example/submit");
  });

  it("fails closed when the base URL is unusable", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: null,
        formAction: "submit",
        baseURI: "about:blank",
        documentURL: DOC,
      }),
    ).toBeNull();
  });
});

describe("resolveFormActionUrl scheme gate (#650)", () => {
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:void(0)",
    "data:text/html,<h1>x</h1>",
    "blob:https://app.example/uuid",
    "file:///etc/passwd",
    "ftp://files.example/x",
  ])("rejects non-HTTP form action %s", (formAction) => {
    expect(
      resolveFormActionUrl({
        submitterAction: null,
        formAction,
        baseURI: BASE,
        documentURL: DOC,
      }),
    ).toBeNull();
  });

  it("rejects a non-HTTP submitter formaction even when the form action is safe", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: "javascript:void(0)",
        formAction: "https://app.example/safe",
        baseURI: BASE,
        documentURL: DOC,
      }),
    ).toBeNull();
  });

  it("rejects padded javascript: URLs that the URL parser would accept", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: null,
        formAction: "  javascript:alert(1)  ",
        baseURI: BASE,
        documentURL: DOC,
      }),
    ).toBeNull();
  });
});

describe("resolveFormActionUrl attribute precedence (#650)", () => {
  it("lets a present formaction override the form action", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: "https://pay.example/checkout",
        formAction: "https://app.example/submit",
        baseURI: BASE,
        documentURL: DOC,
      }),
    ).toBe("https://pay.example/checkout");
  });

  it("treats an explicitly empty formaction as the current document", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: "",
        formAction: "https://app.example/submit",
        baseURI: BASE,
        documentURL: DOC,
      }),
    ).toBe(DOC);
  });

  it("inherits the form action only when formaction is missing", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: null,
        formAction: "https://app.example/submit",
        baseURI: BASE,
        documentURL: DOC,
      }),
    ).toBe("https://app.example/submit");
  });

  it("resolves missing actions to the current document URL", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: null,
        formAction: null,
        baseURI: BASE,
        documentURL: DOC,
      }),
    ).toBe(DOC);
  });

  it("returns null for a non-HTTP document URL with no action", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: null,
        formAction: null,
        baseURI: "file:///tmp/x.html",
        documentURL: "file:///tmp/x.html",
      }),
    ).toBeNull();
  });

  it("fails closed on unparseable input", () => {
    expect(
      resolveFormActionUrl({
        submitterAction: null,
        formAction: "https://[invalid",
        baseURI: BASE,
        documentURL: DOC,
      }),
    ).toBeNull();
  });
});
