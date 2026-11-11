export type StopProgress = { last?: string; now?: string; next?: string; then?: string };

// "Last stop → Now at / Next stop → Then" for the top of a stop list.
// beforeIndex/progress come from the live position projected onto the stop
// timeline (beforeIndex is the stop being approached); stoppedIndex is a
// published "stopped at" stop when the feed has one.
export function getStopProgress(
  stopNames: string[],
  position: { beforeIndex: number; progress: number } | null | undefined,
  stoppedIndex?: number,
): StopProgress | null {
  let atIndex = stoppedIndex !== undefined && stoppedIndex >= 0 ? stoppedIndex : -1;
  if (atIndex < 0 && position) {
    if (position.progress <= 0.05) atIndex = position.beforeIndex - 1;
    else if (position.progress >= 0.95) atIndex = position.beforeIndex;
  }
  if (atIndex >= 0 && stopNames[atIndex]) {
    return { last: stopNames[atIndex - 1], now: stopNames[atIndex], then: stopNames[atIndex + 1] };
  }
  if (!position || !stopNames[position.beforeIndex]) return null;
  return { last: stopNames[position.beforeIndex - 1], next: stopNames[position.beforeIndex], then: stopNames[position.beforeIndex + 1] };
}
