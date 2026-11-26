// Trip/run-aware matching for surface vehicles (trams, and buses which share
// the same departure board code). A route number on its own ("86") names a
// whole line with dozens of trams running both ways at once; the things that
// actually identify ONE service are:
//   - the physical vehicle (fleet number, e.g. tram 3001),
//   - the run (PTV v3 run_ref / run_id), and
//   - the scheduled trip (GTFS trip_id), plus its direction.
// Everything here prefers those, and only falls back to a nearest-vehicle
// guess on the same route when the guess is still consistent with the
// departure's direction and timing. Plain TS with no imports so it runs
// under `node --test` directly.

export type SurfaceVehicleIdentity = {
  id: string;
  tripId?: string;
  /** PTV v3 run_ref, only present when the vehicle came from the v3 fallback feed. */
  runRef?: string;
  fleetNumber?: string;
  route: string;
  destination?: string;
  /** PTV v3 direction_id (NOT the GTFS 0/1 direction_id — they are different numbering schemes). */
  ptvDirectionId?: string;
  lat: number;
  lng: number;
};

export type SurfaceDepartureIdentity = {
  route: string;
  destination?: string;
  expectedAt?: string;
  status?: string;
  runId?: string;
  runRef?: string;
  /** Vehicle PTV has assigned to this run (vehicle_descriptor.id), when it publishes one. */
  fleetNumber?: string;
  ptvDirectionId?: string;
};

export type DepartureVehicleMatch<V> = {
  vehicle: V;
  /**
   * "vehicle": PTV says this exact tram runs the departure.
   * "run": the departure's run/trip ID is this vehicle's run/trip ID.
   * "estimated": nearest tram on the same route and direction — a guess.
   */
  confidence: "vehicle" | "run" | "estimated";
};

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const canonical = (value: unknown) => clean(value).toUpperCase();

// PTV's realtime trip_id carries a "service pattern" segment that differs
// from the static timetable's (realtime "03-86--7-T5-142606618" vs static
// "03-86--5-T5-142606618"), and can change between polls for the same trip.
// Dropping that one segment gives a key that is stable for one trip. Mirrors
// normaliseScheduleTripKey in api/ptv/live-trams.js.
export function normaliseTripKey(tripId: unknown): string {
  const value = clean(tripId);
  const parts = value.split("-");
  if (parts.length < 6) return value;
  return [...parts.slice(0, 3), ...parts.slice(4)].join("-");
}

export function isSameTrip(left: unknown, right: unknown): boolean {
  const a = clean(left);
  const b = clean(right);
  if (!a || !b) return false;
  return a === b || normaliseTripKey(a) === normaliseTripKey(b);
}

/** The trailing trip number of a PTV GTFS trip_id ("03-86--5-T5-142606618" → "142606618"). */
export function tripNumberFromTripId(tripId: unknown): string | undefined {
  const match = clean(tripId).match(/-(\d{3,})$/);
  return match?.[1];
}

/** Does this live vehicle belong to the trip/run a focus key or journey was attached to? */
export function vehicleMatchesTripKey(vehicle: { id: string; tripId?: string; runRef?: string }, requestedKey: unknown): boolean {
  const key = clean(requestedKey);
  if (!key) return false;
  return isSameTrip(vehicle.tripId ?? vehicle.id, key) || (Boolean(vehicle.runRef) && clean(vehicle.runRef) === key);
}

function distanceInMetres(from: [number, number], to: [number, number]) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(to[0] - from[0]);
  const dLng = toRadians(to[1] - from[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from[0])) * Math.cos(toRadians(to[0])) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normaliseStopName(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/\b(station|interchange|terminus|depot|sc|shopping centre)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isKnownDestination(value: unknown) {
  const name = normaliseStopName(value);
  return Boolean(name) && name !== "destination unavailable";
}

// "unknown" when neither side says enough to tell. A contradiction is the
// only thing that rules a candidate out — missing data never does.
export function directionAgreement(
  departure: SurfaceDepartureIdentity,
  vehicle: SurfaceVehicleIdentity,
): "same" | "opposite" | "unknown" {
  if (clean(departure.ptvDirectionId) && clean(vehicle.ptvDirectionId)) {
    return clean(departure.ptvDirectionId) === clean(vehicle.ptvDirectionId) ? "same" : "opposite";
  }
  if (isKnownDestination(departure.destination) && isKnownDestination(vehicle.destination)) {
    const a = normaliseStopName(departure.destination);
    const b = normaliseStopName(vehicle.destination);
    return a.includes(b) || b.includes(a) ? "same" : "opposite";
  }
  return "unknown";
}

function findExactMatch<V extends SurfaceVehicleIdentity>(
  departure: SurfaceDepartureIdentity,
  vehicles: V[],
): DepartureVehicleMatch<V> | null {
  const fleetNumber = canonical(departure.fleetNumber);
  if (fleetNumber) {
    const vehicle = vehicles.find((candidate) => canonical(candidate.fleetNumber) === fleetNumber);
    if (vehicle) return { vehicle, confidence: "vehicle" };
  }
  const runKeys = [clean(departure.runRef), clean(departure.runId)].filter(Boolean);
  if (runKeys.length > 0) {
    const vehicle = vehicles.find((candidate) =>
      runKeys.some((key) => clean(candidate.runRef) === key || isSameTrip(candidate.tripId ?? candidate.id, key)),
    );
    if (vehicle) return { vehicle, confidence: "run" };
  }
  return null;
}

export type MatchDeparturesOptions = {
  now?: number;
  /** Max distance from the stop for a same-route guess. */
  maxDistanceMetres?: number;
  /** Departures further out than this never get a guessed vehicle — the nearest tram is almost certainly an earlier run. */
  maxEstimateMinutes?: number;
};

/**
 * Pairs each departure on a stop's board with the live vehicle running it.
 * Returns an array aligned with `departures` (null = no trustworthy match).
 *
 * Exact identities (fleet number, run, trip) win. Remaining departures, in
 * departure-time order, may each claim the nearest still-unclaimed vehicle on
 * the same route heading the same way — so two upcoming 86s get two
 * different trams, and a tram heading the other way is never offered.
 */
export function matchDeparturesToLiveVehicles<V extends SurfaceVehicleIdentity>(
  departures: SurfaceDepartureIdentity[],
  vehicles: V[],
  stopPosition: [number, number],
  { now = Date.now(), maxDistanceMetres = 1500, maxEstimateMinutes = 20 }: MatchDeparturesOptions = {},
): Array<DepartureVehicleMatch<V> | null> {
  const results: Array<DepartureVehicleMatch<V> | null> = departures.map(() => null);
  const claimed = new Set<V>();

  departures.forEach((departure, index) => {
    if (departure.status === "cancelled") return;
    const match = findExactMatch(departure, vehicles.filter(vehicle =>
      canonical(vehicle.route) === canonical(departure.route) && directionAgreement(departure, vehicle) !== "opposite",
    ));
    if (match && !claimed.has(match.vehicle)) {
      results[index] = match;
      claimed.add(match.vehicle);
    }
  });

  const order = departures
    .map((departure, index) => ({ departure, index, at: Date.parse(departure.expectedAt ?? "") }))
    .sort((left, right) => (Number.isFinite(left.at) ? left.at : Infinity) - (Number.isFinite(right.at) ? right.at : Infinity));

  for (const { departure, index, at } of order) {
    if (results[index]) continue;
    if (departure.status === "cancelled") continue;
    // PTV named a specific tram for this run and it isn't in the live feed:
    // any other tram would be the wrong one.
    if (clean(departure.fleetNumber)) continue;
    if (!Number.isFinite(at) || at < now - 60_000 || at - now > maxEstimateMinutes * 60_000) continue;

    const route = canonical(departure.route);
    let best: { vehicle: V; distance: number } | null = null;
    for (const vehicle of vehicles) {
      if (claimed.has(vehicle)) continue;
      if (!route || canonical(vehicle.route) !== route) continue;
      if (directionAgreement(departure, vehicle) !== "same") continue;
      const distance = distanceInMetres([vehicle.lat, vehicle.lng], stopPosition);
      if (distance > maxDistanceMetres) continue;
      if (!best || distance < best.distance) best = { vehicle, distance };
    }
    if (best) {
      results[index] = { vehicle: best.vehicle, confidence: "estimated" };
      claimed.add(best.vehicle);
    }
  }

  return results;
}
