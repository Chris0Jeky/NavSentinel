import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

it("keeps an active Happy DOM MutationObserver listener alive across forced GC", () => {
  const script = String.raw`
    import { Window } from "happy-dom";

    const window = new Window();
    const target = window.document.createElement("div");
    const delivered = [];
    let observer = new window.MutationObserver(records => delivered.push(...records));
    observer.observe(target, { attributes: true });

    // Happy DOM owns the observer after observe(). The internal listener must
    // keep its forwarding closure alive even when this local reference is gone.
    observer = null;
    await new Promise(resolve => setImmediate(resolve));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      globalThis.gc();
      await new Promise(resolve => setImmediate(resolve));
    }

    target.setAttribute("data-observed", "yes");
    await new Promise(resolve => setImmediate(resolve));

    if (delivered.length !== 1 || delivered[0].attributeName !== "data-observed") {
      throw new Error(
        "MutationObserver listener was collected before an active observation completed",
      );
    }
  `;

  const result = spawnSync(
    process.execPath,
    ["--expose-gc", "--input-type=module", "--eval", script],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    },
  );

  expect(result.status, result.stderr || result.stdout).toBe(0);
});
