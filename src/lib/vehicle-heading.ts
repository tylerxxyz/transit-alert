type Coordinate = readonly [number, number];
type RouteStop = { name: string; position: Coordinate };

export function validVehicleHeading(heading?: number): number | undefined {
  return typeof heading === "number" && Number.isFinite(heading) && heading >= 0 && heading <= 360
    ? heading % 360
    : undefined;
}

/** A train that has just reversed at a platform keeps reporting its arrival
 * bearing until it moves. When the feed points more than 90° away from the
 * track toward the destination, the track direction is the one to trust. */
export function resolveVehicleHeading(feedHeading: number | undefined, trackHeading: number | undefined): number | undefined {
  const feed = validVehicleHeading(feedHeading);
  if (trackHeading === undefined) return feed;
  if (feed === undefined) return trackHeading;
  const difference = Math.abs(((feed - trackHeading) % 360 + 540) % 360 - 180);
  return difference > 90 ? trackHeading : feed;
}

const stationKey =(name: string) => name.toLowerCase().replace(/\bstation\b/g, "").replace(/\s+/g, " ").trim();

/** Infer a local track bearing only when the destination identifies its direction.
 * Up/down are railway operating directions, not compass directions. */
export function inferVehicleHeading(position: Coordinate, stops: readonly RouteStop[], destination: string): number | undefined {
  // Feed destinations can read "Flinders Street → Frankston" or "Flinders
  // Street via City Loop"; only the final station names the direction. On
  // loop patterns the destination can also appear earlier in the list, and
  // the last occurrence is where the train is actually heading.
  const finalDestination = stationKey(
    (destination.split("→").at(-1) ?? destination).replace(/\s+via\b.*$/i, "").replace(/\(.*?\)/g, ""),
  );
  const destinationIndex = stops.findLastIndex((stop) => stationKey(stop.name) === finalDestination);
  if (destinationIndex < 0 || stops.length < 2) return undefined;
  const scale = Math.cos(position[0] * Math.PI / 180);
  let nearest: { index: number; progress: number; distance: number } | undefined;
  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index].position;
    const to = stops[index + 1].position;
    const dx = (to[1] - from[1]) * scale;
    const dy = to[0] - from[0];
    const length = dx * dx + dy * dy;
    if (length === 0) continue;
    const progress = Math.max(0, Math.min(1, (((position[1] - from[1]) * scale * dx) + (position[0] - from[0]) * dy) / length));
    const distance = Math.hypot((position[1] - from[1]) * scale - progress * dx, position[0] - from[0] - progress * dy);
    if (!nearest || distance < nearest.distance) nearest = { index, progress, distance };
  }
  // Do not point along a different corridor, or invent a departure direction at
  // the destination itself. Feed bearings remain authoritative in those cases.
  if (!nearest || nearest.distance * 111_320 > 2_000 || Math.abs(destinationIndex - nearest.index - nearest.progress) < 0.001) return undefined;
  const forward = destinationIndex > nearest.index + nearest.progress;
  const from = stops[nearest.index + (forward ? 0 : 1)].position;
  const to = stops[nearest.index + (forward ? 1 : 0)].position;
  const radians = Math.PI / 180;
  const deltaLng = (to[1] - from[1]) * radians;
  const y = Math.sin(deltaLng) * Math.cos(to[0] * radians);
  const x = Math.cos(from[0] * radians) * Math.sin(to[0] * radians) - Math.sin(from[0] * radians) * Math.cos(to[0] * radians) * Math.cos(deltaLng);
  return (Math.atan2(y, x) / radians + 360) % 360;
}
