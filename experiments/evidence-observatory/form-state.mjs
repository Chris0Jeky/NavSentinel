/** Select recorded intent snapshots; document association is not native causality. */
export function selectFormIntent(c, cursor) {
  if (!c?.formEvidence || !Array.isArray(c.events) || !Number.isInteger(cursor) || cursor < 0 || cursor >= c.events.length) return null;
  if (c.formEvidence.bindingPolicy === 'CDP_DEFAULT_WORLD_DOCUMENT') {
    const selectedDocument = c.events[cursor].documentId;
    const snapshots = c.formEvidence.snapshots.filter(v => v.eventIndex <= cursor && (!selectedDocument || v.binding?.documentId === selectedDocument));
    const current = snapshots.at(-1);
    if (!current) return null;
    const doc = c.formEvidence.documents.find(d => d.documentId === current.binding?.documentId);
    if (!doc || doc.startIndex > cursor || (doc.endIndex !== null && doc.endIndex <= cursor)) return null;
    const earlier = snapshots.findLast(v => v.phase === 'input' && v.binding?.documentId === current.binding.documentId) ?? null;
    return structuredClone({ earlier, current, association: earlier ? 'same-reporting-document' : 'no-reported-input' });
  }
  // Preserve the conservative v1 interval model without inventing document IDs.
  let boundary = -1;
  for (let i = 0; i <= cursor; i++) if (c.events[i].source === 'browser' && c.events[i].kind === 'navigation.committed') boundary = i;
  const snapshots = c.formEvidence.snapshots.filter(v => v.eventIndex <= cursor && v.eventIndex > boundary);
  const current = snapshots.at(-1);
  if (!current) return null;
  const earlier = snapshots.findLast(v => v.phase === 'input') ?? snapshots[0];
  return structuredClone({ earlier, current, association:'legacy-unbound' });
}
