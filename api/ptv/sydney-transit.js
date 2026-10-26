import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import AdmZip from "adm-zip";
import { feedBearing } from "../_lib/vehicle-bearing.js";

// Opt-in Sydney layer (see LayerState.sydneyTransit in Map.tsx) — this is a
// separate NSW Transport Open Data product from the "nswtrains" feed used for
// interstate/regional NSW TrainLink in live-trains.js. Buses alone return
// ~1,700 vehicles across greater Sydney, so this is intentionally its own
// endpoint the client only calls when the layer is switched on, not folded
// into the always-on Melbourne fetch.
const SYDNEY_BUSES_URL = "https://api.transport.nsw.gov.au/v1/gtfs/vehiclepos/buses";
const SYDNEY_LIGHT_RAIL_FEEDS = [
  { key: "cbdandsoutheast", url: "https://api.transport.nsw.gov.au/v1/gtfs/vehiclepos/lightrail/cbdandsoutheast", operator: "Sydney Light Rail (CBD & South East)" },
  { key: "newcastle", url: "https://api.transport.nsw.gov.au/v1/gtfs/vehiclepos/lightrail/newcastle", operator: "Newcastle Light Rail" },
];
const SYDNEY_METRO_URL = "https://api.transport.nsw.gov.au/v1/gtfs/vehiclepos/metro";

// Loosely greater-Sydney/Central Coast/Illawarra — wide enough to keep every
// real Sydney-network vehicle without also pulling in unrelated regional NSW
// buses that might appear at the edges of the statewide "buses" feed.
const SYDNEY_BOUNDS = { minLat: -34.6, maxLat: -32.6, minLng: 150.4, maxLng: 152.2 };

// Real per-route operator names (Victoria's live bus feed also has this gap
// — see BUS_ROUTE_OPERATORS in live-buses.js — but Sydney's own static GTFS
// bus schedule already carries this directly, so no hand-maintained
// directory is needed here). NSW bus route_ids are formatted
// "<agency_id>_<route_short_name>" (confirmed live: e.g. "2508_100"), and
// that agency_id is exactly agency.txt's own id (confirmed: "2508" ->
// "Keolis Downer Northern Beaches") — the real contracted operator, not a
// guess. Downloading the ~100MB static schedule just for its 3KB
// agency.txt is wasteful per-request, so this is cached for a day; operator
// contracts don't change often enough to need it fresher than that.
const SYDNEY_BUS_SCHEDULE_URL = "https://api.transport.nsw.gov.au/v1/gtfs/schedule/buses";
const SYDNEY_BUS_AGENCY_CACHE_MS = 24 * 60 * 60 * 1000;
let sydneyBusAgencyCache = { loadedAt: 0, lookup: null };
let sydneyBusAgencyPromise;

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

async function loadSydneyBusAgencyLookup(apiKey) {
  const now = Date.now();
  if (sydneyBusAgencyCache.lookup && now - sydneyBusAgencyCache.loadedAt < SYDNEY_BUS_AGENCY_CACHE_MS) {
    return sydneyBusAgencyCache.lookup;
  }
  if (!sydneyBusAgencyPromise) {
    sydneyBusAgencyPromise = (async () => {
      const response = await fetch(SYDNEY_BUS_SCHEDULE_URL, {
        headers: { Authorization: `apikey ${apiKey}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        throw new Error(`Sydney bus schedule request failed (${response.status})`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const zip = new AdmZip(buffer);
      const agencyText = zip.readAsText("agency.txt");
      const lines = agencyText.split(/\r?\n/).filter((line) => line.trim());
      const header = parseCsvLine(lines[0]).map((value) => value.replace(/^"|"$/g, ""));
      const idIndex = header.indexOf("agency_id");
      const nameIndex = header.indexOf("agency_name");
      const lookup = new Map();
      for (const line of lines.slice(1)) {
        const columns = parseCsvLine(line).map((value) => value.replace(/^"|"$/g, ""));
        const id = columns[idIndex]?.trim();
        const name = columns[nameIndex]?.trim();
        if (id && name) lookup.set(id, name);
      }
      return lookup;
    })();
  }
  try {
    const lookup = await sydneyBusAgencyPromise;
    sydneyBusAgencyCache = { loadedAt: now, lookup };
    return lookup;
  } finally {
    sydneyBusAgencyPromise = undefined;
  }
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return undefined;
}

function withinSydneyBounds(lat, lng) {
  return lat >= SYDNEY_BOUNDS.minLat && lat <= SYDNEY_BOUNDS.maxLat && lng >= SYDNEY_BOUNDS.minLng && lng <= SYDNEY_BOUNDS.maxLng;
}

async function fetchGtfsFeed(url, apiKey) {
  const response = await fetch(url, {
    headers: {
      Authorization: `apikey ${apiKey}`,
      Accept: "application/x-google-protobuf",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`${url}:unavailable:${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
}

function buildSydneyBuses(feed, agencyLookup) {
  return (feed.entity ?? [])
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;
      if (!vehicle || !position) return null;
      const lat = position.latitude;
      const lng = position.longitude;
      if (typeof lat !== "number" || typeof lng !== "number" || !withinSydneyBounds(lat, lng)) return null;

      const routeId = vehicle.trip?.routeId;
      const route = typeof routeId === "string" && routeId.trim() ? routeId.trim() : "Bus";
      const timestamp = toNumber(vehicle.timestamp);
      const label = vehicle.vehicle?.label || vehicle.vehicle?.id || route;
      // route_id is "<agency_id>_<route_short_name>" (e.g. "2508_100") — the
      // agency_id prefix is the real contracted operator's id in the static
      // schedule's own agency.txt.
      const agencyId = route.split("_")[0];
      const operator = agencyLookup?.get(agencyId) || "Sydney bus network";

      return {
        id: entity.id || vehicle.vehicle?.id || `${route}-${lat}-${lng}`,
        label,
        vehicleId: vehicle.vehicle?.id,
        registration: vehicle.vehicle?.licensePlate,
        tripId: vehicle.trip?.tripId,
        lat,
        lng,
        route,
        status: "live",
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
        heading: feedBearing(position),
        operator,
      };
    })
    .filter(Boolean);
}

function buildSydneyLightRail(feed, operator) {
  return (feed.entity ?? [])
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;
      if (!vehicle || !position) return null;
      const lat = position.latitude;
      const lng = position.longitude;
      if (typeof lat !== "number" || typeof lng !== "number") return null;

      const tripId = vehicle.trip?.tripId;
      const routeId = vehicle.trip?.routeId;
      const route = typeof routeId === "string" && routeId.trim() ? routeId.trim() : "Light rail";
      const timestamp = toNumber(vehicle.timestamp);

      return {
        id: entity.id || vehicle.vehicle?.id || `${route}-${lat}-${lng}`,
        tripId: typeof tripId === "string" && tripId.trim() ? tripId.trim() : undefined,
        label: vehicle.vehicle?.label || route,
        lat,
        lng,
        route,
        status: "live",
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
        heading: feedBearing(position),
        operator,
      };
    })
    .filter(Boolean);
}

function buildSydneyMetroTrains(feed) {
  return (feed.entity ?? [])
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;
      if (!vehicle || !position) return null;
      const lat = position.latitude;
      const lng = position.longitude;
      if (typeof lat !== "number" || typeof lng !== "number") return null;

      const tripId = vehicle.trip?.tripId;
      const routeId = vehicle.trip?.routeId;
      const label = vehicle.vehicle?.label || vehicle.vehicle?.id;
      const timestamp = toNumber(vehicle.timestamp);
      const directionId = toNumber(vehicle.trip?.directionId);

      // Shaped to fit the LiveTrain type (see src/lib/live-trains.ts) so the
      // existing metro/regional marker + detail-panel rendering can be reused
      // as-is — same pattern as folding NSW TrainLink into that pipeline.
      return {
        tdn: label || routeId || "Sydney Metro",
        tripId,
        lat,
        lng,
        line: "Sydney Metro",
        destination: "Sydney Metro",
        status: "on_time",
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
        direction: directionId === 0 ? "up" : directionId === 1 ? "down" : "outbound",
        heading: feedBearing(position),
        trainType: "Sydney Metro",
        consist: label || "Sydney Metro",
        serviceDescription: "Sydney Metro",
      };
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  const apiKey =
    process.env.NSW_TRANSPORT_API_KEY ||
    process.env.TRANSPORT_NSW_API_KEY ||
    process.env.TFNSW_API_KEY ||
    process.env.NSW_OPENDATA_API_KEY;

  if (!apiKey) {
    res.status(503).json({
      error: "Sydney transit needs an NSW Transport Open Data API key.",
      code: "NSW_KEY_REQUIRED",
      buses: [],
      trams: [],
      trains: [],
    });
    return;
  }

  const [busesResult, lightRailResults, metroResult, agencyLookupResult] = await Promise.allSettled([
    fetchGtfsFeed(SYDNEY_BUSES_URL, apiKey),
    Promise.allSettled(SYDNEY_LIGHT_RAIL_FEEDS.map((feedSource) => fetchGtfsFeed(feedSource.url, apiKey))),
    fetchGtfsFeed(SYDNEY_METRO_URL, apiKey),
    // The 24h cache means this almost never actually re-downloads the
    // (large, ~100MB) static schedule on the request path.
    loadSydneyBusAgencyLookup(apiKey),
  ]);

  const agencyLookup = agencyLookupResult.status === "fulfilled" ? agencyLookupResult.value : null;
  if (agencyLookupResult.status === "rejected") {
    console.warn("[sydney-transit] bus operator lookup unavailable:", agencyLookupResult.reason instanceof Error ? agencyLookupResult.reason.message : agencyLookupResult.reason);
  }
  const buses = busesResult.status === "fulfilled" ? buildSydneyBuses(busesResult.value, agencyLookup) : [];

  const trams =
    lightRailResults.status === "fulfilled"
      ? lightRailResults.value.flatMap((result, index) =>
          result.status === "fulfilled" ? buildSydneyLightRail(result.value, SYDNEY_LIGHT_RAIL_FEEDS[index].operator) : [],
        )
      : [];

  const trains = metroResult.status === "fulfilled" ? buildSydneyMetroTrains(metroResult.value) : [];

  for (const result of [busesResult, metroResult]) {
    if (result.status === "rejected") {
      console.warn("[sydney-transit] feed request failed:", result.reason instanceof Error ? result.reason.message : result.reason);
    }
  }

  res.status(200).json({ buses, trams, trains });
}
