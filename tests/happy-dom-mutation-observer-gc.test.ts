import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

it("keeps native Happy DOM MutationObserver delivery alive across forced GC", () => {
  const script = String.raw`
    import { Window } from "happy-dom";

    const window = new Window();
    const target = window.document.createElement("div");
    const delivered = [];
    const observer = new window.MutationObserver(records => delivered.push(...records));
    observer.observe(target, { attributes: true });

    // Re-observing the same target must update the registration rather than
    // creating duplicate delivery paths.
    observer.observe(target, { attributes: true, attributeOldValue: true });

    await new Promise(resolve => setImmediate(resolve));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      globalThis.gc();
      await new Promise(resolve => setImmediate(resolve));
    }

    target.setAttribute("data-observed", "yes");
    await new Promise(resolve => setImmediate(resolve));

    if (
      delivered.length !== 1 ||
      delivered[0].attributeName !== "data-observed" ||
      delivered[0].oldValue !== null
    ) {
      throw new Error(
        "Native MutationObserver registration did not survive GC or was duplicated",
      );
    }

    observer.disconnect();
    target.setAttribute("data-after-disconnect", "ignored");
    await new Promise(resolve => setImmediate(resolve));
    if (delivered.length !== 1 || observer.takeRecords().length !== 0) {
      throw new Error("disconnect() did not stop native MutationObserver delivery");
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
