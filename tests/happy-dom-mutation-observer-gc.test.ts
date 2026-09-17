import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const retentionHelper = pathToFileURL(
  path.join(root, "tests/helpers/happy-dom-mutation-observer-retention.mjs"),
).href;

it("keeps an active Happy DOM MutationObserver listener alive across forced GC", () => {
  const script = String.raw`
    import { Window } from "happy-dom";
    import {
      installHappyDomMutationObserverRetention,
      retainedHappyDomMutationCallbackCountForTesting,
    } from ${JSON.stringify(retentionHelper)};

    const window = new Window();
    installHappyDomMutationObserverRetention(window);
    const target = window.document.createElement("div");
    const delivered = [];
    const observer = new window.MutationObserver(records => delivered.push(...records));
    observer.observe(target, { attributes: true });

    if (retainedHappyDomMutationCallbackCountForTesting(observer) !== 1) {
      throw new Error("The actual Happy DOM forwarding closure was not retained");
    }

    // Re-observing the same target updates the existing listener rather than
    // retaining a duplicate closure.
    observer.observe(target, { attributes: true, attributeOldValue: true });
    if (retainedHappyDomMutationCallbackCountForTesting(observer) !== 1) {
      throw new Error("Re-observing the same target retained a duplicate callback");
    }

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

    observer.disconnect();
    if (retainedHappyDomMutationCallbackCountForTesting(observer) !== 0) {
      throw new Error("disconnect() did not release the retained forwarding closure");
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
