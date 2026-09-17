import { describe, expect, it, vi } from "vitest";
import { removeReleaseTempRoot } from "./helpers/release_temp_cleanup";

describe("release test temporary-root cleanup (#723)", () => {
  it("requests bounded recursive retries from fs.rmSync", () => {
    const remove = vi.fn();

    removeReleaseTempRoot("/tmp/fixture", remove);

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("/tmp/fixture", {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  });

  it("does not mask a persistent cleanup failure", () => {
    const failure = Object.assign(new Error("persistent cleanup failure"), {
      code: "ENOTEMPTY",
    });

    expect(() => removeReleaseTempRoot("/tmp/fixture", () => {
      throw failure;
    })).toThrow(failure);
  });
});
