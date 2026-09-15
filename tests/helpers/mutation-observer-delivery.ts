/** A bounded test-only handshake; never advance the monitor's debounce clock. */
export const MUTATION_DELIVERY_TURNS = 8;

export async function flushMutationObserverDelivery(
  flushRecords: () => void,
  pendingCount: () => number,
): Promise<void> {
  for (let turn = 0; turn < MUTATION_DELIVERY_TURNS; turn++) {
    // takeRecords() and the DOM implementation's queued callback can race.
    // Retry the real drain on every turn, checking the monitor-owned queue.
    flushRecords();
    if (pendingCount() > 0) return;
    if (turn + 1 < MUTATION_DELIVERY_TURNS) await Promise.resolve();
  }
  // Missing delivery is still a failed test, never a skip or a broad timeout.
  throw new Error(`MutationObserver delivered no pending records after ${MUTATION_DELIVERY_TURNS} drain attempts`);
}
