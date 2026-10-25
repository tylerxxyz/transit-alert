import { findStationCoordinate } from "@/lib/station-coordinates";
import { readJsonErrorMessage, readJsonResponse, responseIsJson } from "@/lib/http-json";
import { fetchConsistSnapshot } from "@/lib/transportvic-bot";
import { getApiUrl } from "@/lib/api-config";

export type LiveTrain = {
  leadingSet?: { setId: string; source: string; sourceUrl: string; observedAt: string } | null;
  serviceDate?: string;
  vehicleId?: string;
  allocation?: { tripId: string; serviceDate: string; stockType: "VLocity";
    setIds: string[]; carCount: number; source: string; observedAt: string; validUntil: string } | null;
  tdn: string;
  tripId?: string;
  lat: number;
  lng: number;
  line: string;
  origin?: string;
  destination: string;
  status?: "on_time" | "delayed" | "early";
  timestamp?: string;
  direction: "up" | "down" | "city-bound" | "outbound";
  heading?: number;
  trainType: string;
  consist: string;
  serviceDescription?: string;
};

const VLINE_KEYWORDS = [
  "v/line",
  "vline",
  "nsw trainlink",
  "trainlink",
  "xpt",
  "xplorer",
  "waurn ponds",
  "wendouree",
  "ballarat",
  "bendigo",
  "echuca",
  "swan hill",
  "ararat",
  "maryborough",
  "geelong",
  "warrnambool",
  "seymour",
  "shepparton",
  "albury",
  "sydney central",
  "brisbane",
  "canberra",
  "casino",
  "dubbo",
  "armidale",
  "moree",
  "griffith",
  "traralgon",
  "bairnsdale",
  "stony point",
];

type LiveTrainResponse =
  | LiveTrain[]
  | {
      trains?: LiveTrain[];
    };

type StableTrainRecord = {
  train: LiveTrain;
  feedTime: number;
  seenAt: number;
};

const stableTrainRecords = new Map<string, StableTrainRecord>();
const RETAIN_MISSING_TRAIN_MS = 75_000;
const MAX_PLAUSIBLE_TRAIN_SPEED_KMH = 220;

function getStableTrainIdentity(train: LiveTrain) {
  const consist = train.consist.trim();
  if (consist && !/^unknown$/i.test(consist)) return `consist:${consist}`;
  if (train.tripId) return `trip:${train.tripId}`;
  return `tdn:${train.tdn}`;
}

function coordinateDistanceKm(left: LiveTrain, right: LiveTrain) {
  const radians = (value: number) => value * Math.PI / 180;
  const deltaLat = radians(right.lat - left.lat);
  const deltaLng = radians(right.lng - left.lng);
  const lat1 = radians(left.lat);
  const lat2 = radians(right.lat);
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function reconcileTrainSnapshot(trains: LiveTrain[]) {
  const now = Date.now();
  const snapshot = new Map<string, LiveTrain>();

  for (const train of trains) {
    if (!Number.isFinite(train.lat) || !Number.isFinite(train.lng)) continue;
    if (train.lat < -40 || train.lat > -32 || train.lng < 140 || train.lng > 153) continue;

    const identity = getStableTrainIdentity(train);
    const candidateFeedTime = train.timestamp ? Date.parse(train.timestamp) : now;
    const feedTime = Number.isFinite(candidateFeedTime) ? candidateFeedTime : now;
    const previous = stableTrainRecords.get(identity);

    if (previous && feedTime < previous.feedTime) {
      snapshot.set(identity, previous.train);
      previous.seenAt = now;
      continue;
    }

    if (previous && feedTime > previous.feedTime) {
      const elapsedHours = Math.max((feedTime - previous.feedTime) / 3_600_000, 1 / 3600);
      const speedKmh = coordinateDistanceKm(previous.train, train) / elapsedHours;
      if (speedKmh > MAX_PLAUSIBLE_TRAIN_SPEED_KMH) {
        snapshot.set(identity, previous.train);
        previous.seenAt = now;
        continue;
      }
    }

    stableTrainRecords.set(identity, { train, feedTime, seenAt: now });
    snapshot.set(identity, train);
  }

  for (const [identity, record] of stableTrainRecords) {
    if (snapshot.has(identity)) continue;
    if (now - record.seenAt <= RETAIN_MISSING_TRAIN_MS) snapshot.set(identity, record.train);
    else stableTrainRecords.delete(identity);
  }

  return [...snapshot.values()];
}

export type LiveViewportBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

function normaliseConsistLabel(value: unknown) {
  if (typeof value !== "string") {
    return "Unknown";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "Unknown";
  }

  if (/^aus:vic:vic-02-[A-Z0-9]+:/i.test(trimmed) || /^vic-02-[A-Z0-9]+:/i.test(trimmed)) {
    return "Unknown";
  }

  return trimmed;
}

function normaliseLiveTrain(raw: Partial<LiveTrain> & Record<string, unknown>, index: number): LiveTrain | null {
  if (typeof raw.lat !== "number" || typeof raw.lng !== "number") {
    return null;
  }

  const rawLine = typeof raw.line === "string" && raw.line.trim() ? raw.line : "";
  const destination = typeof raw.destination === "string" && raw.destination.trim() ? raw.destination : "Unknown";
  const serviceDescription = typeof raw.serviceDescription === "string" ? raw.serviceDescription : undefined;
  const inferredLine =
    !rawLine || /^metro$/i.test(rawLine) || /^unknown$/i.test(rawLine)
      ? inferLineFromText(destination, serviceDescription, typeof raw.tdn === "string" ? raw.tdn : undefined)
      : rawLine;

  return {
    tdn: typeof raw.tdn === "string" && raw.tdn.trim() ? raw.tdn : `train-${index}`,
    tripId: typeof raw.tripId === "string" && raw.tripId.trim() ? raw.tripId : undefined,
    lat: raw.lat,
    lng: raw.lng,
    line: inferredLine,
    origin: typeof raw.origin === "string" && raw.origin.trim() ? raw.origin.trim() : undefined,
    destination,
    status:
      raw.status === "on_time" || raw.status === "delayed" || raw.status === "early"
        ? raw.status
        : "on_time",
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : undefined,
    direction:
      raw.direction === "up" ||
      raw.direction === "down" ||
      raw.direction === "city-bound" ||
      raw.direction === "outbound"
        ? raw.direction
        : "down",
    heading: typeof raw.heading === "number" ? raw.heading : undefined,
    trainType:
      typeof raw.trainType === "string" && raw.trainType.trim()
        ? raw.trainType
        : inferredLine === "V/Line" || /^01-/.test(typeof raw.tripId === "string" ? raw.tripId : "") || /-STY--/i.test(typeof raw.tripId === "string" ? raw.tripId : "")
          ? "V/Line Train"
          : "Metro Train",
    consist: normaliseConsistLabel(raw.consist),
    serviceDate: raw.serviceDate,
    vehicleId: raw.vehicleId,
    allocation: raw.allocation ?? null,
    leadingSet: raw.leadingSet ?? null,
    serviceDescription,
  };
}

function inferDirection(destination?: string | null): LiveTrain["direction"] {
  const normalised = destination?.trim().toLowerCase() ?? "";

  if (!normalised) {
    return "down";
  }

  if (
    normalised.includes("flinders street") ||
    normalised.includes("southern cross") ||
    normalised.includes("city")
  ) {
    return "city-bound";
  }

  return "outbound";
}

function inferLine(origin?: string | null, destination?: string | null) {
  const joined = `${origin ?? ""} ${destination ?? ""}`.toLowerCase();

  if (joined.includes("williamstown") || joined.includes("newport") || joined.includes("werribee")) {
    return "Williamstown";
  }

  if (joined.includes("sandringham")) {
    return "Sandringham";
  }

  if (joined.includes("frankston") || joined.includes("stony point")) {
    return "Frankston";
  }

  return "Metro";
}

function inferLineFromText(...values: Array<string | null | undefined>) {
  const joined = values
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (!joined) return "Metro";
  if (/(nsw trainlink|trainlink|xpt)/i.test(joined)) return "NSW TrainLink XPT";
  if (/(xplorer)/i.test(joined)) return "NSW TrainLink Xplorer";
  if (VLINE_KEYWORDS.some((keyword) => joined.includes(keyword))) return "V/Line";
  if (/(werribee|williamstown|newport|laverton|altona)/i.test(joined)) return "Williamstown";
  if (/(sandringham)/i.test(joined)) return "Sandringham";
  if (/(frankston|stony point)/i.test(joined)) return "Frankston";
  if (/(mernda)/i.test(joined)) return "Mernda";
  if (/(hurstbridge)/i.test(joined)) return "Hurstbridge";
  if (/(belgrave)/i.test(joined)) return "Belgrave";
  if (/(lilydale)/i.test(joined)) return "Lilydale";
  if (/(glen waverley)/i.test(joined)) return "Glen Waverley";
  if (/(alamein)/i.test(joined)) return "Alamein";
  if (/(upfield)/i.test(joined)) return "Upfield";
  if (/(craigieburn)/i.test(joined)) return "Craigieburn";
  if (/(sunbury)/i.test(joined)) return "Sunbury";
  if (/(cranbourne)/i.test(joined)) return "Cranbourne";
  if (/(pakenham)/i.test(joined)) return "Pakenham";
  if (/(metro tunnel|munnel)/i.test(joined)) return "Metro Tunnel";
  return "Metro";
}

// Stony Point's real route code is "STY" (confirmed in the static schedule:
// trip_ids like "02-STY--1-T5-8518"), which survives in tripId untouched
// regardless of what the live feed's own routeId happens to resolve to for
// a given direction — the inbound (Stony Point -> Frankston) direction's
// real trip_headsign is "Frankston", so a run whose live line/destination
// both come back "Frankston" (no other text mentioning Stony Point at all)
// was silently falling out of every V/Line-bucket check here and being
// misclassified as ordinary Melbourne metro stock. tripId doesn't have that
// direction-dependent gap.
export function isVlineLiveTrain(train: Pick<LiveTrain, "line" | "destination" | "serviceDescription" | "trainType" | "tripId">) {
  const joined = `${train.line} ${train.destination} ${train.serviceDescription ?? ""} ${train.trainType}`.toLowerCase();
  return train.line.trim().toLowerCase() === "v/line"
    || VLINE_KEYWORDS.some((keyword) => joined.includes(keyword))
    || /-STY--/i.test(train.tripId ?? "");
}

// NSW TrainLink is a distinct interstate operator that shares the same
// "regional" bucket as V/Line in isVlineLiveTrain (both need the same city-vs-
// regional map/UI treatment), but it is NOT V/Line — display code that
// branches only on isVlineLiveTrain and assumes the non-metro case must be
// V/Line (operator label, origin fallback, etc.) needs this narrower check
// first to avoid mislabelling a real NSW TrainLink XPT as a V/Line service.
export function isNswTrainLinkLiveTrain(train: Pick<LiveTrain, "line" | "destination" | "serviceDescription" | "trainType">) {
  const joined = `${train.line} ${train.destination} ${train.serviceDescription ?? ""} ${train.trainType}`.toLowerCase();
  return /(nsw trainlink|trainlink|\bxpt\b|xplorer)/.test(joined);
}

// The Sydney Trains suburban network (T1-T9) — a separate live feed from
// both NSW TrainLink (regional/interstate) and Sydney Metro, added so it
// stops silently falling through to the Melbourne classifier below and
// getting labelled as X'Trapolis.
export function isSydneyTrainsLiveTrain(train: Pick<LiveTrain, "line" | "destination" | "serviceDescription" | "trainType">) {
  const joined = `${train.line} ${train.destination} ${train.serviceDescription ?? ""} ${train.trainType}`.toLowerCase();
  return /sydney trains/.test(joined);
}

// The Werribee/Williamstown/Altona/Sandringham group runs real point-to-point
// through services connecting two outer termini via Flinders Street (e.g. a
// genuine Williamstown-to-Sandringham working), unlike a City Loop line where
// both ends of the day's diagram are the same place. For these, "via
// <origin>" is the real, useful fact (which of the two termini this service
// actually came from) — showing "via Flinders Street" instead would just
// restate the interchange every cross-city service already passes through.
export function isCrossCityLiveTrain(train: Pick<LiveTrain, "line" | "destination" | "serviceDescription" | "trainType">) {
  const joined = `${train.line} ${train.destination} ${train.serviceDescription ?? ""} ${train.trainType}`.toLowerCase();
  return /\b(werribee|williamstown|altona|sandringham)\b/.test(joined);
}

function calculateBearing(from: [number, number], to: [number, number]) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const toDegrees = (value: number) => (value * 180) / Math.PI;
  const [fromLat, fromLng] = from;
  const [toLat, toLng] = to;
  const phi1 = toRadians(fromLat);
  const phi2 = toRadians(toLat);
  const lambda = toRadians(toLng - fromLng);
  const y = Math.sin(lambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);
  const theta = toDegrees(Math.atan2(y, x));
  return (theta + 360) % 360;
}

async function fetchTrackedConsistFallback(): Promise<LiveTrain[]> {
  const snapshot = await fetchConsistSnapshot("430M");
  const line = inferLine(
    snapshot.current_trip?.origin ?? snapshot.next_trip?.origin,
    snapshot.current_trip?.destination ?? snapshot.next_trip?.destination,
  );
  const destination = snapshot.current_trip?.destination ?? snapshot.next_trip?.destination ?? "Awaiting next trip";
  const coordinate =
    typeof snapshot.position?.lat === "number" && typeof snapshot.position?.lng === "number"
      ? [snapshot.position.lat, snapshot.position.lng]
      : null;

  if (!coordinate) {
    return [];
  }

  const currentStopCoordinate = findStationCoordinate(snapshot.position?.current_stop);
  const nextStopCoordinate = findStationCoordinate(snapshot.position?.next_stop);
  const destinationCoordinate =
    findStationCoordinate(snapshot.current_trip?.destination) ??
    findStationCoordinate(snapshot.next_trip?.destination);
  const inferredHeading =
    currentStopCoordinate && nextStopCoordinate
      ? calculateBearing(currentStopCoordinate, nextStopCoordinate)
      : currentStopCoordinate && destinationCoordinate
        ? calculateBearing(currentStopCoordinate, destinationCoordinate)
        : undefined;

  const serviceDescription = snapshot.current_trip
    ? `${snapshot.current_trip.origin} to ${snapshot.current_trip.destination}`
    : snapshot.next_trip
      ? `Waiting at ${snapshot.next_trip.origin} for ${snapshot.next_trip.destination}`
      : "Waiting for next trip";

  return [
    {
      tdn: snapshot.current_trip?.id ?? snapshot.consist,
      lat: coordinate[0],
      lng: coordinate[1],
      line,
      destination,
      status: "on_time",
      timestamp: snapshot.as_of,
      direction: inferDirection(destination),
      heading: inferredHeading,
      trainType: "TransportVic tracked consist",
      consist: snapshot.consist,
      serviceDescription,
    },
  ];
}

export async function fetchLiveTrains(bounds?: LiveViewportBounds): Promise<LiveTrain[]> {
  const searchParams = new URLSearchParams();
  if (bounds) {
    searchParams.set("minLat", String(bounds.minLat));
    searchParams.set("maxLat", String(bounds.maxLat));
    searchParams.set("minLng", String(bounds.minLng));
    searchParams.set("maxLng", String(bounds.maxLng));
  }
  let response: Response;
  try {
    response = await fetch(getApiUrl(`/api/ptv/live-trains${searchParams.size ? `?${searchParams.toString()}` : ""}`));
  } catch (error) {
    if (error instanceof TypeError) {
      return [];
    }
    throw error;
  }

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    const message = await readJsonErrorMessage(response, `Failed to load live trains (${response.status})`);
    throw new Error(message);
  }

  if (!responseIsJson(response)) {
    return [];
  }

  const payload = await readJsonResponse<LiveTrainResponse>(response, "Live trains API");
  const trains = Array.isArray(payload) ? payload : payload.trains ?? [];
  const normalisedTrains = trains
    .map((train, index) => normaliseLiveTrain(train, index))
    .filter((train): train is LiveTrain => train !== null);

  if (normalisedTrains.some((train) => train.consist === "430M")) {
    return reconcileTrainSnapshot(normalisedTrains);
  }

  try {
    const consistFallback = await fetchTrackedConsistFallback();
    return reconcileTrainSnapshot([...normalisedTrains, ...consistFallback]);
  } catch {
    return reconcileTrainSnapshot(normalisedTrains);
  }
}
