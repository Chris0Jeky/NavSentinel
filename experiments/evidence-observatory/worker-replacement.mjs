/** Select a new realm handle, never a stale handle retained during CDP teardown. */
export function selectReplacementWorker(workers, previous, scriptURL) {
  const candidates = workers.filter(worker => worker !== previous && worker.url() === scriptURL);
  // A second same-script handle means the observation is ambiguous. The caller's
  // bounded wait must fail rather than silently adopt an arbitrary restart.
  return candidates.length === 1 ? candidates[0] : undefined;
}
