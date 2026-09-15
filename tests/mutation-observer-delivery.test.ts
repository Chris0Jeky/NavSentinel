import { afterEach, describe, expect, it, vi } from "vitest";
import { flushMutationObserverDelivery, MUTATION_DELIVERY_TURNS } from "./helpers/mutation-observer-delivery";

describe("bounded observer delivery handshake (#693)", () => {
  afterEach(() => vi.useRealTimers());

  it("drains before probing and returns immediately when records are ready", async () => {
    const trace: string[] = [];
    await flushMutationObserverDelivery(
      () => { trace.push("flush"); },
      () => { trace.push("pending"); return 1; },
    );
    expect(trace).toEqual(["flush", "pending"]);
  });

  it.each(Array.from({ length: MUTATION_DELIVERY_TURNS - 1 }, (_, index) => index + 1))(
    "allows delivery after %i microtask turns without advancing timers",
    async deliveryTurn => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      let timerRan = false;
      setTimeout(() => { timerRan = true; }, 1);
      let attempts = 0;
      let pending = 0;
      let probes = 0;
      await flushMutationObserverDelivery(() => {
        attempts++;
        if (attempts === deliveryTurn) void Promise.resolve().then(() => { pending = 1; });
      }, () => { probes++; return pending; });

      expect(attempts).toBe(deliveryTurn + 1);
      expect(probes).toBe(attempts);
      expect(timerRan).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
      vi.clearAllTimers();
    },
  );

  it("fails after exactly the fixed bound when no records arrive", async () => {
    const flush = vi.fn();
    const pending = vi.fn(() => 0);
    await expect(flushMutationObserverDelivery(flush, pending)).rejects.toThrow(
      `no pending records after ${MUTATION_DELIVERY_TURNS} drain attempts`,
    );
    expect(flush).toHaveBeenCalledTimes(MUTATION_DELIVERY_TURNS);
    expect(pending).toHaveBeenCalledTimes(MUTATION_DELIVERY_TURNS);
  });

  it("does not hide a drain or probe error behind retries", async () => {
    const error = new Error("observer unavailable");
    const broken = vi.fn(() => { throw error; });
    const unused = vi.fn(() => 0);
    await expect(flushMutationObserverDelivery(broken, unused)).rejects.toBe(error);
    expect(broken).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
    const flush = vi.fn();
    await expect(flushMutationObserverDelivery(flush, broken)).rejects.toBe(error);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not carry a successful delivery into a later empty handshake", async () => {
    await flushMutationObserverDelivery(() => {}, () => 1);
    const flush = vi.fn();
    await expect(flushMutationObserverDelivery(flush, () => 0)).rejects.toThrow(/no pending records/);
    expect(flush).toHaveBeenCalledTimes(MUTATION_DELIVERY_TURNS);
  });
});
