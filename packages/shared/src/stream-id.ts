export const MAX_STREAM_ID = 0x7fffffff;

export function allocateStreamId(
  cursor: { next: number },
  step: number,
  start: number,
  inFlight: Iterable<number>,
): number {
  const used = new Set<number>(inFlight);
  let candidate = cursor.next;
  if (!Number.isInteger(candidate) || candidate < start || candidate > MAX_STREAM_ID) {
    candidate = start;
  }
  const spunFrom = candidate;
  for (;;) {
    if (candidate > 0 && candidate <= MAX_STREAM_ID && !used.has(candidate)) {
      let next = candidate + step;
      if (next > MAX_STREAM_ID) {
        next = start;
      }
      cursor.next = next;
      return candidate;
    }
    candidate += step;
    if (candidate > MAX_STREAM_ID) {
      candidate = start;
    }
    if (candidate === spunFrom) {
      throw new Error('stream id space exhausted');
    }
  }
}
