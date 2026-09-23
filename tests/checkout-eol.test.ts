import { describe, expect, it } from "vitest";
// @ts-expect-error Release helpers are plain ESM and intentionally have no declaration file.
import { findCrlfWorktreeFiles } from "../scripts/checkout-eol.mjs";

describe("findCrlfWorktreeFiles (#763)", () => {
  it("flags w/crlf entries and reports their paths", () => {
    const output = [
      "i/lf    w/crlf  attr/text=auto eol=lf \tREADME.md",
      "i/lf    w/crlf  attr/text=auto eol=lf \tconfig/release-profiles.json",
      "",
    ].join("\n");
    expect(findCrlfWorktreeFiles(output)).toEqual([
      "README.md",
      "config/release-profiles.json",
    ]);
  });

  it("passes clean LF, unmodified, and binary entries", () => {
    const output = [
      "i/lf    w/lf    attr/text=auto eol=lf \tREADME.md",
      "i/-text w/-text attr/-text \tlogo.png",
      "i/none  w/none  attr/-text \t.gitignore",
      "",
    ].join("\n");
    expect(findCrlfWorktreeFiles(output)).toEqual([]);
  });

  it("handles empty output and blank lines", () => {
    expect(findCrlfWorktreeFiles("")).toEqual([]);
    expect(findCrlfWorktreeFiles("\n\n")).toEqual([]);
  });

  it("is not confused by C-quoted paths containing spaces", () => {
    const output = 'i/lf    w/crlf  attr/text=auto eol=lf \t"my docs/notes.md"\n';
    expect(findCrlfWorktreeFiles(output)).toEqual(['"my docs/notes.md"']);
  });

  it("does not flag a path that merely mentions crlf", () => {
    const output = "i/lf    w/lf    attr/text=auto eol=lf \tcrlf-notes.md\n";
    expect(findCrlfWorktreeFiles(output)).toEqual([]);
  });
});
