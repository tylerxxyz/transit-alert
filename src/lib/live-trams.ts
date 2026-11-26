import { readJsonErrorMessage, readJsonResponse, responseIsJson } from "@/lib/http-json";
import { getApiUrl } from "@/lib/api-config";

export type LiveTram = {
  id: string;
  /** Official GTFS trip ID. Required to match this vehicle to its dated timetable. */
  tripId?: string;
  label: string;
  lat: number;
  lng: number;
  route: string;
  destination?: string;
  status?: "live";
  timestamp?: string;
  heading?: number;
  operator?: string;
  /** The tram's real fleet number (e.g. "2032" for a B2 class), when the live feed publishes one. */
  fleetNumber?: string;
  /** Per-trip number from the trip ID — tells two trams on the same route apart. */
  tripNumber?: string;
  /** GTFS direction_id ("0"/"1") of this trip. */
  directionId?: string;
  /** GTFS-realtime start time/date of this trip (HH:MM:SS / YYYYMMDD), when published. */
  startTime?: string;
  startDate?: string;
  /** PTV v3 run_ref, only when this vehicle came from the v3 fallback feed. */
  runRef?: string;
  /** PTV v3 direction_id, only when this vehicle came from the v3 fallback feed. */
  ptvDirectionId?: string;
};

type LiveTramResponse =
  | LiveTram[]
  | {
      trams?: LiveTram[];
    };

function isRawFeedIdentifier(value: string) {
  return /^aus:vic:vic-02-[A-Z0-9-]+:?$/i.test(value) || /^vic-02-[A-Z0-9-]+:?$/i.test(value);
}

function stripFeedPrefix(value: string) {
  return value
    .replace(/^aus:vic:/i, "")
    .replace(/^vic:/i, "")
    .replace(/:$/g, "");
}

function normaliseRouteLabel(value: unknown) {
  if (typeof value !== "string") {
    return "Tram";
  }

  const trimmed = value.trim().replace(/^(?:aus:vic:)?vic-/i, "").replace(/:+$/, "");
  if (!trimmed) {
    return "Tram";
  }

  const ptvRouteIdMatch = trimmed.match(/^\d{2}-([A-Z]?\d{1,4}[A-Z]?)(?:-|$)/i);
  if (ptvRouteIdMatch?.[1]) {
    return ptvRouteIdMatch[1].toUpperCase();
  }

  const plainRouteMatch = trimmed.match(/\b([A-Z]?\d{1,4}[A-Z]?)\b/i);
  if (plainRouteMatch) {
    return plainRouteMatch[1].toUpperCase();
  }

  if (isRawFeedIdentifier(trimmed)) {
    return "Tram";
  }

  const compact = stripFeedPrefix(trimmed);
  if (compact.length <= 12) {
    return compact.toUpperCase();
  }

  return "Tram";
}

function normaliseDestination(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || isRawFeedIdentifier(trimmed)) {
    return undefined;
  }

  const cleaned = stripFeedPrefix(trimmed).trim();
  if (!cleaned || isRawFeedIdentifier(cleaned)) {
    return undefined;
  }

  return cleaned;
}

function normaliseLabel(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || isRawFeedIdentifier(trimmed)) {
    return undefined;
  }

  const cleaned = stripFeedPrefix(trimmed).trim();
  return cleaned || undefined;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normaliseLiveTram(raw: Partial<LiveTram> & Record<string, unknown>, index: number): LiveTram | null {
  if (typeof raw.lat !== "number" || typeof raw.lng !== "number") {
    return null;
  }

  const route = normaliseRouteLabel(
    typeof raw.route === "string" && raw.route.trim() && raw.route.trim() !== "03"
      ? raw.route
      : typeof raw.id === "string"
        ? raw.id
        : raw.route,
  );
  const cleanLabel = normaliseLabel(raw.label);
  const label =
    cleanLabel
      ? cleanLabel
      : route === "Tram"
        ? `tram-${index + 1}`
        : `Route ${route}`;

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `tram-${index}`,
    tripId: typeof raw.tripId === "string" && raw.tripId.trim() ? raw.tripId.trim() : undefined,
    label,
    lat: raw.lat,
    lng: raw.lng,
    route,
    destination: normaliseDestination(raw.destination),
    status: "live",
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : undefined,
    heading: typeof raw.heading === "number" ? raw.heading : undefined,
    operator: typeof raw.operator === "string" && raw.operator.trim() ? raw.operator : "Yarra Trams",
    fleetNumber: optionalText(raw.fleetNumber),
    tripNumber: optionalText(raw.tripNumber),
    directionId: optionalText(raw.directionId),
    startTime: optionalText(raw.startTime),
    startDate: optionalText(raw.startDate),
    runRef: optionalText(raw.runRef),
    ptvDirectionId: optionalText(raw.ptvDirectionId),
  };
}

export type LiveViewportBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export async function fetchLiveTrams(bounds?: LiveViewportBounds): Promise<LiveTram[]> {
  let response: Response;
  try {
    const search = bounds
      ? `?${new URLSearchParams({
          minLat: String(bounds.minLat),
          maxLat: String(bounds.maxLat),
          minLng: String(bounds.minLng),
          maxLng: String(bounds.maxLng),
        }).toString()}`
      : "";
    response = await fetch(getApiUrl(`/api/ptv/live-trams${search}`));
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
    const message = await readJsonErrorMessage(response, `Failed to load live trams (${response.status})`);
    throw new Error(message);
  }

  if (!responseIsJson(response)) {
    return [];
  }

  const payload = await readJsonResponse<LiveTramResponse>(response, "Live trams API");
  const trams = Array.isArray(payload) ? payload : payload.trams ?? [];

  return trams
    .map((tram, index) => normaliseLiveTram(tram, index))
    .filter((tram): tram is LiveTram => tram !== null);
}
