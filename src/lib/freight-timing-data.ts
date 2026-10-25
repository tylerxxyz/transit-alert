// Freight / heritage / empty-car "pass-through" service data — trains that
// physically run past a station on the same track but never stop there, so
// they never appear in GTFS at all. This is deliberately its own module,
// separate from every GTFS-driven departure path in the app, so a bug here
// can never affect normal passenger next-departure/ordering logic.
//
// Real published sources exist for this data (not fabricated, not guessed):
//   - ARTC Master Train Plan PDFs (interstate freight)
//     https://www.artc.com.au/uploads/MTP_<date>_NSWVIC-*.pdf
//   - V/Line's 7 regional freight-schedule PDFs + the External Heritage
//     Rollingstock Register
//     https://corporate.vline.com.au/Network-Access/Network-service-plan
// This environment currently has no PDF-rendering tool available to
// transcribe those documents, so FREIGHT_TIMING_DATA starts empty. Add an
// entry only once its train number, timing points, and path have been
// verified against one of the sources above — never a fabricated example.

export type NonPassengerServiceType = "PASSING FREIGHT" | "HERITAGE SPECIAL" | "EMPTY CARS" | "NON-PASSENGER";

export interface NonPassengerTimingPoint {
  name: string;
  lat: number;
  lng: number;
  /** "HH:MM:SS", 24h, relative to the service's operating day. */
  scheduledTime: string;
}

export interface NonPassengerService {
  trainNumber: string;
  operator: string;
  serviceType: NonPassengerServiceType;
  origin: string;
  destination: string;
  direction: "up" | "down";
  /** Corridor code matching the vic-01-<CODE>: convention used elsewhere, when applicable. */
  routeId?: string;
  shape: [number, number][];
  timingPoints: NonPassengerTimingPoint[];
  /** Always "Estimated" — this feature has no GPS by design. */
  trackingSource: "Estimated";
}

export const FREIGHT_TIMING_DATA: NonPassengerService[] = [];

/** Per-station, per-direction platform override for pass-through services,
 * for stations whose real track/platform layout doesn't match the simple
 * "up -> usual Up platform, down -> usual Down platform" default. */
export const STATION_NON_PASSENGER_PLATFORM_OVERRIDES: Record<string, Partial<Record<"up" | "down", string>>> = {};

export interface NonPassengerBoardEntry {
  trainNumber: string;
  operator: string;
  serviceType: NonPassengerServiceType;
  direction: "up" | "down";
  expectedPassTime: string;
  platform?: string;
  trackingSource: "Estimated";
  label: "DOES NOT STOP";
}

function toSeconds(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h * 3600 + m * 60 + (s ?? 0);
}

function toTimeString(totalSeconds: number): string {
  const wrapped = ((totalSeconds % 86400) + 86400) % 86400;
  const h = Math.floor(wrapped / 3600);
  const m = Math.floor((wrapped % 3600) / 60);
  const s = Math.floor(wrapped % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function distanceMetres(a: [number, number], b: [number, number]): number {
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

/** Distance from a station position to the nearest point of a polyline, and
 * the cumulative distance along the polyline at that nearest point — the
 * same projection approach used for live vehicle positions elsewhere in the
 * app, reused here to find where a station sits along a freight path. */
function projectOntoShape(shape: [number, number][], point: [number, number]) {
  let best = { distanceFromPoint: Infinity, cumulativeAtProjection: 0 };
  let cumulative = 0;
  for (let i = 1; i < shape.length; i += 1) {
    const segStart = shape[i - 1];
    const segEnd = shape[i];
    const segLength = distanceMetres(segStart, segEnd);
    // Nearest point on this segment to `point`, parameterised 0..1.
    const [lat1, lng1] = segStart;
    const [lat2, lng2] = segEnd;
    const [plat, plng] = point;
    const dx = lng2 - lng1;
    const dy = lat2 - lat1;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((plng - lng1) * dx + (plat - lat1) * dy) / lenSq));
    const projected: [number, number] = [lat1 + t * dy, lng1 + t * dx];
    const distanceFromPoint = distanceMetres(point, projected);
    const cumulativeAtProjection = cumulative + segLength * t;
    if (distanceFromPoint < best.distanceFromPoint) {
      best = { distanceFromPoint, cumulativeAtProjection };
    }
    cumulative += segLength;
  }
  return best;
}

/** Interpolates a scheduled pass time for an arbitrary point along a
 * service's path by finding the two timing points whose cumulative
 * distance along the shape bracket that point, then lerping proportionally
 * by distance — the timetable equivalent of the app's existing spatial
 * stop-interpolation helper, but interpolating by elapsed time instead of
 * just splitting a polyline evenly. */
function interpolatePassTime(service: NonPassengerService, stationCumulativeDistance: number): string | null {
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

function resolvePlatform(service: NonPassengerService, stationName: string): string | undefined {
  return STATION_NON_PASSENGER_PLATFORM_OVERRIDES[stationName]?.[service.direction];
}

/** Real, path-based "does this freight/heritage/empty-car service pass this
 * station" check — a station only gets an entry if it's genuinely between
 * the service's origin and destination on its own path, and it never gets
 * one for the origin/destination stations themselves (a service doesn't
 * "pass through without stopping" at the ends of its own journey). */
export function getNonPassengerPassThroughs(
  stationName: string,
  stationPosition: [number, number],
  maxDistanceMetres = 150,
): NonPassengerBoardEntry[] {
  const entries: NonPassengerBoardEntry[] = [];
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

/** Estimated live-map position for a pass-through service at a given
 * instant, by the same distance-along-path + time-bracket interpolation as
 * the board's pass-time calculation — always an estimate, never treated as
 * a real GPS fix. Returns null once/before the service is off this path. */
export function interpolatePositionAtTime(
  service: NonPassengerService,
  nowSeconds: number,
): [number, number] | null {
  if (service.timingPoints.length < 2 || service.shape.length < 2) return null;
  const firstSeconds = toSeconds(service.timingPoints[0].scheduledTime);
  const lastSeconds = toSeconds(service.timingPoints[service.timingPoints.length - 1].scheduledTime);
  if (nowSeconds < firstSeconds || nowSeconds > lastSeconds) return null;

  const cumulativeAtTimingPoint = service.timingPoints.map(
    (tp) => projectOntoShape(service.shape, [tp.lat, tp.lng]).cumulativeAtProjection,
  );
  let targetCumulative: number | null = null;
  for (let i = 1; i < service.timingPoints.length; i += 1) {
    const prevSeconds = toSeconds(service.timingPoints[i - 1].scheduledTime);
    const nextSeconds = toSeconds(service.timingPoints[i].scheduledTime);
    if (nowSeconds >= prevSeconds && nowSeconds <= nextSeconds) {
      const span = nextSeconds - prevSeconds;
      const ratio = span === 0 ? 0 : (nowSeconds - prevSeconds) / span;
      targetCumulative = cumulativeAtTimingPoint[i - 1] + (cumulativeAtTimingPoint[i] - cumulativeAtTimingPoint[i - 1]) * ratio;
      break;
    }
  }
  if (targetCumulative === null) return null;

  let cumulative = 0;
  for (let i = 1; i < service.shape.length; i += 1) {
    const segStart = service.shape[i - 1];
    const segEnd = service.shape[i];
    const segLength = distanceMetres(segStart, segEnd);
    if (cumulative + segLength >= targetCumulative) {
      const ratio = segLength === 0 ? 0 : (targetCumulative - cumulative) / segLength;
      return [segStart[0] + (segEnd[0] - segStart[0]) * ratio, segStart[1] + (segEnd[1] - segStart[1]) * ratio];
    }
    cumulative += segLength;
  }
  return service.shape[service.shape.length - 1];
}
