import { getApiUrl } from "@/lib/api-config";
import { readJsonErrorMessage } from "@/lib/http-json";

export type VerifiedDeparture = {
  tripId: string;
  route: string;
  destination: string;
  platform?: string;
  scheduledAt: string;
  expectedAt: string;
  status: "scheduled" | "live" | "cancelled" | "skipped";
  delaySeconds?: number;
  serviceDate: string;
};

export type NonPassengerPassThrough = {
  trainNumber: string;
  operator: string;
  serviceType: "PASSING FREIGHT" | "HERITAGE SPECIAL" | "EMPTY CARS" | "NON-PASSENGER";
  direction: "up" | "down";
  expectedPassTime: string;
  platform?: string;
  trackingSource: "Estimated";
  label: "DOES NOT STOP";
};

export type StationDeparturesPayload = {
  stationName: string;
  departures: VerifiedDeparture[];
  // Freight/heritage/empty-car services that run through this station
  // without stopping — a separate, non-GTFS source, never merged into
  // `departures` so it can't affect real passenger ordering/next-service logic.
  nonPassengerPassThroughs?: NonPassengerPassThrough[];
  generatedAt?: string;
  realtimeFeedAt?: string;
  scheduleUpdatedAt?: string;
  source?: string;
  error?: string;
};

export type VerifiedBusStop = {
  stopId: string;
  stopSequence: number;
  name: string;
  stopCode?: string;
  lat?: number;
  lng?: number;
  expectedAt?: string;
  status: "passed" | "upcoming" | "skipped";
};

export type BusTripPayload = {
  tripId: string;
  scheduledTripId?: string;
  route?: string;
  destination?: string;
  stops: VerifiedBusStop[];
  formationSegments?: BusFormationSegment[];
  generatedAt?: string;
  realtimeFeedAt?: string;
  scheduleUpdatedAt?: string;
  source?: string;
};

export type TramTripPayload = BusTripPayload;

export type SurfaceStopDeparturesPayload = {
  stopId: string;
  stopName: string;
  route: string;
  departures: Array<{
    route: string;
    destination: string;
    scheduledAt: string;
    expectedAt: string;
    status: "scheduled" | "live" | "cancelled";
    platform?: string;
    runId?: string;
  }>;
  generatedAt?: string;
  source?: string;
};

export type BusFormationSegment = {
  tripId: string;
  route?: string;
  origin?: string;
  destination?: string;
  departsAt?: string;
  arrivesAt?: string;
};

export type VerifiedTrainStop = {
  platformSource?: "LIVE" | "SCHEDULED" | "EXPECTED" | "static_direction" | "service_override";
  stopId: string;
  stopSequence: number;
  name: string;
  platform?: string;
  pickupType?: "none";
  dropOffType?: "none";
  lat?: number;
  lng?: number;
  scheduledArrivalAt: string;
  scheduledDepartureAt: string;
  expectedArrivalAt: string;
  expectedDepartureAt: string;
  delaySeconds: number;
  dwellSeconds: number;
  status: "passed" | "upcoming" | "skipped";
};

export type TrainFormationSegment = {
  tripId: string;
  tdn: string;
  route?: string;
  direction: "UP" | "DOWN";
  origin?: string;
  destination?: string;
  departsAt?: string;
  arrivesAt?: string;
};

export type TrainTripPayload = {
  serviceWorkings?: Array<{ crossCity: boolean; crossCityKind?: "flinders-street" | "metro-tunnel"; connectionSource?: "scheduled-turnaround"; segments: TrainFormationSegment[] }>;
  previousWorkingStatus?: "stabled" | "unknown";
  nextWorkingStatus?: "stabled" | "unknown";

  scheduledTripId?: string;
  nextServices?: Array<TrainFormationSegment & { source: "LIVE" | "SCHEDULED" }>;
  tripId: string;
  route?: string;
  destination?: string;
  serviceDate?: string;
  stops: VerifiedTrainStop[];
  segmentTripIds?: string[];
  segments?: TrainFormationSegment[];
  formationSegments?: TrainFormationSegment[];
  previousFormationStatus?: "linked" | "stabled" | "unknown";
  nextFormationStatus?: "linked" | "stabled" | "unknown";
  handover?: {
    station: string;
    fromTripId: string;
    toTripId: string;
  };
  generatedAt?: string;
  realtimeFeedAt?: string;
  scheduleUpdatedAt?: string;
  source?: string;
};

export type JourneyPlanStop = {
  name: string;
  lat: number;
  lng: number;
  mode: "train" | "tram" | "bus";
};

export type JourneyPlanLeg = {
  mode: "train" | "tram" | "bus" | "walk";
  routeLabel: string;
  headsign?: string;
  from: string;
  to: string;
  stopsCount: number;
  approxSeconds: number;
  distanceMetres?: number;
  // Real GTFS shape geometry trimmed to this leg's boarding/alighting stops
  // (bus legs only, when the route's shape was found) — the actual road the
  // bus drives, not a straight line jumping stop to stop.
  shapePositions?: [number, number][];
};

export type JourneyPlanResult = {
  found: boolean;
  reason?: "origin-not-found" | "destination-not-found" | "no-route";
  alreadyThere?: boolean;
  stops?: JourneyPlanStop[];
  legs?: JourneyPlanLeg[];
  walkFromOriginSeconds?: number;
  totalApproxSeconds?: number;
  error?: string;
};

export async function fetchJourneyPlan(params: {
  originName?: string;
  originLat?: number;
  originLng?: number;
  destinationName?: string;
  destinationLat?: number;
  destinationLng?: number;
}): Promise<JourneyPlanResult> {
  const search = new URLSearchParams();
  if (params.originName) search.set("originName", params.originName);
  if (params.originLat !== undefined) search.set("originLat", String(params.originLat));
  if (params.originLng !== undefined) search.set("originLng", String(params.originLng));
  if (params.destinationName) search.set("destinationName", params.destinationName);
  if (params.destinationLat !== undefined) search.set("destinationLat", String(params.destinationLat));
  if (params.destinationLng !== undefined) search.set("destinationLng", String(params.destinationLng));
  const response = await fetch(getApiUrl(`/api/journey/plan?${search.toString()}`), { credentials: "include" });
  const payload = (await response.json().catch(() => ({}))) as JourneyPlanResult;
  if (!response.ok && !payload.error) {
    payload.error = "Journey planning is unavailable right now.";
  }
  return payload;
}

async function readTimetableResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await readJsonErrorMessage(response, "Verified timetable data is unavailable."));
  }
  return response.json() as Promise<T>;
}

export async function fetchStationDepartures(stationName: string): Promise<StationDeparturesPayload> {
  const search = new URLSearchParams({ type: "station", station: stationName });
  return readTimetableResponse(
    await fetch(getApiUrl(`/api/ptv/timetable?${search.toString()}`), { credentials: "include" }),
  );
}

export async function fetchBusTrip(tripId: string): Promise<BusTripPayload> {
  const search = new URLSearchParams({ type: "bus-trip", tripId });
  return readTimetableResponse(
    await fetch(getApiUrl(`/api/ptv/timetable?${search.toString()}`), { credentials: "include" }),
  );
}

export async function fetchTramTrip(tripId: string): Promise<TramTripPayload> {
  const search = new URLSearchParams({ type: "tram-trip", tripId });
  return readTimetableResponse(
    await fetch(getApiUrl(`/api/ptv/timetable?${search.toString()}`), { credentials: "include" }),
  );
}

export async function fetchSurfaceStopDepartures(stop: { mode: "bus" | "tram"; route: string; lat: number; lng: number }): Promise<SurfaceStopDeparturesPayload> {
  const search = new URLSearchParams({ type: "surface-stop", mode: stop.mode, route: stop.route, lat: String(stop.lat), lng: String(stop.lng) });
  return readTimetableResponse(
    await fetch(getApiUrl(`/api/ptv/timetable?${search.toString()}`), { credentials: "include" }),
  );
}

export async function fetchTrainTrip(tripId: string): Promise<TrainTripPayload> {
  const search = new URLSearchParams({ type: "train-trip", tripId });
  return readTimetableResponse(
    await fetch(getApiUrl(`/api/ptv/timetable?${search.toString()}`), { credentials: "include" }),
  );
}
