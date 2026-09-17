/** Return the last actual measurement at/before the selected event; never interpolate. */
export function selectScene(events, cursor) {
  const end = Math.min(cursor, events.length - 1);
  let index = end;
  while (index >= 0 && !(events[index]?.kind === 'scene.sample' && events[index]?.data?.scene)) index--;
  if (index < 0) return null;
  const event = events[index], scene = structuredClone(event.data.scene);
  const parents = new Map();
  for (const observed of events.slice(0, index + 1)) {
    const context = observed.data?.context;
    if (context?.frameId) parents.set(context.frameId, context.parentFrameId ?? null);
  }
  for (const box of scene.boxes) {
    if (box?.frameId) parents.set(box.frameId, box.parentFrameId ?? null);
  }
  const isSelfOrAncestor = (candidate, frameId) => {
    const visited = new Set();
    let current = frameId;
    while (current && !visited.has(current)) {
      if (current === candidate) return true;
      visited.add(current);
      current = parents.get(current) ?? null;
    }
    return false;
  };
  let invalidated = false;
  for (const e of events.slice(index + 1, end + 1)) {
    const frame = e.data?.context;
    if (frame?.frameId && (e.kind === 'frame.detached' || e.kind === 'navigation.committed')) {
      invalidated ||= scene.boxes.some(box => {
        if (!isSelfOrAncestor(frame.frameId, box.frameId)) return false;
        if (e.kind === 'frame.detached') return true;
        return box.frameId !== frame.frameId || box.documentId !== frame.documentId;
      });
    }
    if (frame?.frameId) parents.set(frame.frameId, frame.parentFrameId ?? null);
  }
  const now = events[end]?.elapsedMs, then = event.elapsedMs;
  return { eventId: event.id, eventIndex: index, elapsedMs: then, scene, invalidated,
    ageMs: Number.isFinite(now) && Number.isFinite(then) && now >= then ? now - then : null };
}
