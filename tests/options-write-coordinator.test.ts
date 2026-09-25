import { describe, expect, it, vi } from "vitest";
import { OptionsWriteCoordinator } from "../extension/src/options/options_model";
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
};
describe("Options same-instance write ordering (#690)", () => {
  it("drains admitted save and preference writes before import, rejecting later writes", async () => {
    const q = new OptionsWriteCoordinator(), gate = deferred(), seen: string[] = [];
    const save = q.write(async () => { seen.push("save"); await gate.promise; });
    const preference = q.write(async () => { seen.push("preference"); });
    const importing = q.import(async () => { seen.push("import"); });
    expect(q.importPending).toBe(true);
    const late = vi.fn(async () => {});
    await q.write(late);
    expect(seen).toEqual(["save"]);
    gate.resolve(); await Promise.all([save, preference, importing]);
    expect(seen).toEqual(["save", "preference", "import"]);
    expect(late).not.toHaveBeenCalled(); expect(q.importPending).toBe(false);
  });
  it("prevents overlapping imports without postponing a stale second file", async () => {
    const q = new OptionsWriteCoordinator(), gate = deferred(), duplicate = vi.fn(async () => {});
    const first = q.import(() => gate.promise);
    await q.import(duplicate); expect(duplicate).not.toHaveBeenCalled();
    gate.resolve(); await first;
  });
  it("releases the lock after import failure so recovery autosave can run", async () => {
    const q = new OptionsWriteCoordinator(), save = vi.fn(async () => {});
    await expect(q.import(async () => { throw Error("invalid JSON"); })).rejects.toThrow("invalid JSON");
    expect(q.importPending).toBe(false); await q.write(save); expect(save).toHaveBeenCalledOnce();
  });
  it("a failed earlier writer does not prevent import", async () => {
    const q = new OptionsWriteCoordinator(), imported = vi.fn(async () => {});
    const failed = q.write(async () => { throw Error("disconnected"); });
    const importing = q.import(imported);
    await expect(failed).rejects.toThrow("disconnected"); await importing;
    expect(imported).toHaveBeenCalledOnce();
  });
});
