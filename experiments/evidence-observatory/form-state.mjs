/** Select projected form snapshots, never native execution or authenticated document identity. */
export function selectFormIntent(c, cursor) {
  if (!c?.formEvidence || !Array.isArray(c.events) || !Number.isInteger(cursor) || cursor < 0 || cursor >= c.events.length) return null;
  let boundary = -1;
  for (let i = 0; i <= cursor; i++) if (c.events[i].source === 'browser' && c.events[i].kind === 'navigation.committed') boundary = i;
  const snapshots = c.formEvidence.snapshots.filter(v => v.eventIndex <= cursor && v.eventIndex > boundary);
  const current = snapshots.at(-1);
  if (!current) return null;
  const earlier = snapshots.findLast(v => v.phase === 'input') ?? snapshots[0];
  return structuredClone({ earlier, current });
}
