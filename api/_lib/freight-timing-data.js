// Freight / heritage / empty-car "pass-through" service data — trains that
// physically run past a station on the same track but never stop there, so
// they never appear in GTFS at all. Deliberately its own module, kept
// separate from every GTFS-driven departure path in this file, so a bug
// here can never affect normal passenger next-departure/ordering logic.
//
// Mirrors src/lib/freight-timing-data.ts (same shape, same math) rather than
// importing it, since this api/_lib directory is plain JS with no build step
// bridging it to the TypeScript frontend — see that file for the full
// rationale and the real published data sources this should eventually be
// populated from. Keep both in sync if the shape changes.

export const FREIGHT_TIMING_DATA = [];

export const STATION_NON_PASSENGER_PLATFORM_OVERRIDES = {};

function toSeconds(time) {
  const [h, m, s] = time.split(":").map(Number);
  return h * 3600 + m * 60 + (s ?? 0);
}

function toTimeString(totalSeconds) {
  const wrapped = ((totalSeconds % 86400) + 86400) % 86400;
  const h = Math.floor(wrapped / 3600);
  const m = Math.floor((wrapped % 3600) / 60);
  const s = Math.floor(wrapped % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function distanceMetres(a, b) {
  const R = 6371000;
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function projectOntoShape(shape, point) {
  let best = { distanceFromPoint: Infinity, cumulativeAtProjection: 0 };
  let cumulative = 0;
  for (let i = 1; i < shape.length; i += 1) {
    const segStart = shape[i - 1];
    const segEnd = shape[i];
    const segLength = distanceMetres(segStart, segEnd);
    const [lat1, lng1] = segStart;
    const [lat2, lng2] = segEnd;
    const [plat, plng] = point;
    const dx = lng2 - lng1;
    const dy = lat2 - lat1;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((plng - lng1) * dx + (plat - lat1) * dy) / lenSq));
    const projected = [lat1 + t * dy, lng1 + t * dx];
    const distanceFromPoint = distanceMetres(point, projected);
    const cumulativeAtProjection = cumulative + segLength * t;
    if (distanceFromPoint < best.distanceFromPoint) {
      best = { distanceFromPoint, cumulativeAtProjection };
    }
    cumulative += segLength;
  }
  return best;
}

function interpolatePassTime(service, stationCumulativeDistance) {
  if (service.timingPoints.length < 2) return null;
  const cumulativeAtTimingPoint = service.timingPoints.map(
    (tp) => projectOntoShape(service.shape, [tp.lat, tp.lng]).cumulativeAtProjection,
  );
  for (let i = 1; i < service.timingPoints.length; i += 1) {
    const prevDist = cumulativeAtTimingPoint[i - 1];
    const nextDist = cumulativeAtTimingPoint[i];
    if (stationCumulativeDistance >= prevDist && stationCumulativeDistance <= nextDist) {
      const span = nextDist - prevDist;
      const ratio = span === 0 ? 0 : (stationCumulativeDistance - prevDist) / span;
      const prevSeconds = toSeconds(service.timingPoints[i - 1].scheduledTime);
      const nextSeconds = toSeconds(service.timingPoints[i].scheduledTime);
      return toTimeString(prevSeconds + (nextSeconds - prevSeconds) * ratio);
    }
  }
  return null;
}

function resolvePlatform(service, stationName) {
  return STATION_NON_PASSENGER_PLATFORM_OVERRIDES[stationName]?.[service.direction];
}

// Real, path-based "does this freight/heritage/empty-car service pass this
// station" check — a station only gets an entry if it's genuinely between
// the service's origin and destination on its own path, and never for the
// origin/destination stations themselves.
export function getNonPassengerPassThroughs(stationName, stationPosition, maxDistanceMetres = 150) {
  const entries = [];
  for (const service of FREIGHT_TIMING_DATA) {
    if (stationName === service.origin || stationName === service.destination) continue;
    const projection = projectOntoShape(service.shape, stationPosition);
    if (projection.distanceFromPoint > maxDistanceMetres) continue;
    const expectedPassTime = interpolatePassTime(service, projection.cumulativeAtProjection);
    if (!expectedPassTime) continue;
    entries.push({
      trainNumber: service.trainNumber,
      operator: service.operator,
      serviceType: service.serviceType,
      direction: service.direction,
      expectedPassTime,
      platform: resolvePlatform(service, stationName),
      trackingSource: "Estimated",
      label: "DOES NOT STOP",
    });
  }
  return entries.sort((a, b) => a.expectedPassTime.localeCompare(b.expectedPassTime));
}
