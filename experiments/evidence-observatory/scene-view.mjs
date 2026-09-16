/** Return the last actual measurement at/before the selected event; never interpolate. */
export function selectScene(events, cursor) {
  const end = Math.min(cursor, events.length - 1);
  let index = end;
  while (index >= 0 && !(events[index]?.kind === 'scene.sample' && events[index]?.data?.scene)) index--;
  if (index < 0) return null;
  const event = events[index], scene = structuredClone(event.data.scene);
  const invalidated = events.slice(index + 1, end + 1).some(e => {
    const frame = e.data?.context;
    return frame && scene.boxes.some(box => box.frameId === frame.frameId &&
      (e.kind === 'frame.detached' || e.kind === 'navigation.committed' && box.documentId !== frame.documentId));
  });
  const now = events[end]?.elapsedMs, then = event.elapsedMs;
  return { eventId: event.id, eventIndex: index, elapsedMs: then, scene, invalidated,
    ageMs: Number.isFinite(now) && Number.isFinite(then) && now >= then ? now - then : null };
}
