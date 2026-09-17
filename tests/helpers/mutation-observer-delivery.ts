import { setImmediate as scheduleImmediate } from "node:timers";

/** A bounded test-only handshake; never advance the monitor's debounce clock. */
export const MUTATION_DELIVERY_TURNS = 8;

function yieldObserverDeliveryTurn(): Promise<void> {
  // Imported before each test enables fake timers, this remains a real event-loop
  // turn. Microtasks run first, while the monitor's fake debounce timers stay put.
  return new Promise<void>((resolve) => scheduleImmediate(resolve));
}

export async function flushMutationObserverDelivery(
  flushRecords: () => void,
  pendingCount: () => number,
): Promise<void> {
  for (let turn = 0; turn < MUTATION_DELIVERY_TURNS; turn++) {
    // takeRecords() and the DOM implementation's queued callback can race.
    // Retry the real drain on every turn, checking the monitor-owned queue.
    flushRecords();
    if (pendingCount() > 0) return;
    if (turn + 1 < MUTATION_DELIVERY_TURNS) {
      await yieldObserverDeliveryTurn();
    }
  }
  // Missing delivery is still a failed test, never a skip or a broad timeout.
  throw new Error(`MutationObserver delivered no pending records after ${MUTATION_DELIVERY_TURNS} drain attempts`);
}
