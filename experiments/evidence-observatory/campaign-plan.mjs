/** Fixed, opt-in test lanes. Frozen before the first new challenge qualification. */
export const CHALLENGES = Object.freeze([
  Object.freeze({ id: 'narrow-reinsert-900', churn: true, clickDelayMs: 900, viewport: Object.freeze({ width: 840, height: 760 }) }),
  Object.freeze({ id: 'wide-reinsert-2600', churn: true, clickDelayMs: 2600, viewport: Object.freeze({ width: 1520, height: 1000 }) }),
]);
const lanes = Object.freeze({
  overlay: Object.freeze({ id: 'overlay', config: 'playwright.config.mjs', output: 'observatory-campaign', report: 'observatory-campaign-report', binding: 'observatory-input-binding.json' }),
  faults: Object.freeze({ id: 'faults', config: 'playwright.faults.config.mjs', output: 'observatory-faults', report: 'observatory-fault-report', binding: 'observatory-fault-input-binding.json' }),
  challenges: Object.freeze({ id: 'challenges', config: 'playwright.challenges.config.mjs', output: 'observatory-challenges', report: 'observatory-challenge-report', binding: 'observatory-challenge-input-binding.json' }),
});
export function selectLane(args) {
  if (!Array.isArray(args) || args.length > 1 || !Object.hasOwn(lanes, args[0] ?? 'overlay')) throw new Error('LANE_ARGUMENT_INVALID');
  return lanes[args[0] ?? 'overlay'];
}
