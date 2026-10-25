import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { isPtvV3Configured, ptvV3Fetch } from "../_lib/ptv-v3.js";
import { getVerifiedTrainMarkerDestination, resolveStaticTripIdByRouteAndStartTime } from "../_lib/ptv-timetable.js";

const PTV_FEEDS = [
  {
    key: "metro",
    baseUrl: "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro",
    defaultLine: "Metro",
    trainType: "Metro Train",
  },
  {
    key: "vline",
    baseUrl: "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/vline",
    defaultLine: "V/Line",
    trainType: "V/Line Train",
  },
];

const NSW_TRAINS_VEHICLE_POSITIONS_URL = "https://api.transport.nsw.gov.au/v1/gtfs/vehiclepos/nswtrains";
// Separate Transport for NSW Open Data feed from nswtrains above — that one
// is NSW TrainLink's regional/interstate fleet (XPT, Xplorer, ...); this is
// the Sydney Trains suburban network (T1-T9), which had no live feed wired
// in at all before this, so it always showed zero vehicles on the Fleet
// Tracker regardless of what was actually running. Sydney Trains was only
// ever published on Open Data's v2 vehicle-positions product — v1 404s for
// it even though v1 is correct for nswtrains/metro/buses/lightrail above.
const SYDNEY_TRAINS_VEHICLE_POSITIONS_URL = "https://api.transport.nsw.gov.au/v2/gtfs/vehiclepos/sydneytrains";
// Sydney Trains' live vehicle positions carry no fleet-class field (see the
// comment on buildSydneyTrainsLiveTrains), but Transport for NSW's own
// static schedule for the same product does: trips.txt has a real
// vehicle_category_id per trip, resolved to a real name ("8 car Waratah",
// "4 car Tangara", ...) via vehicle_categories.txt — confirmed by fetching
// both directly and checking that live trip_ids match static trip_ids
// exactly. This is real, sourced data, not a guess from vehicle numbering.
const SYDNEY_TRAINS_SCHEDULE_URL = "https://api.transport.nsw.gov.au/v1/gtfs/schedule/sydneytrains";
const SYDNEY_TRAINS_FLEET_CACHE_MS = 12 * 60 * 60 * 1000;
let sydneyTrainsFleetCache = { loadedAt: 0, tripCategory: new Map(), categoryNames: new Map(), routeInfo: new Map() };
let sydneyTrainsFleetPromise = null;

function parseGtfsCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') { field += '"'; i += 1; } else quoted = !quoted;
    } else if (ch === "," && !quoted) { row.push(field); field = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = "";
    } else field += ch;
  }
  const headers = rows.shift().map((value) => value.replace(/^﻿/, ""));
  return rows.map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""])));
}

async function loadSydneyTrainsFleetLookup(apiKey) {
  if (Date.now() - sydneyTrainsFleetCache.loadedAt < SYDNEY_TRAINS_FLEET_CACHE_MS) {
    return sydneyTrainsFleetCache;
  }
  if (!sydneyTrainsFleetPromise) {
    sydneyTrainsFleetPromise = (async () => {
      const [{ default: AdmZip }, response] = await Promise.all([
        import("adm-zip"),
        fetch(SYDNEY_TRAINS_SCHEDULE_URL, {
          headers: { Authorization: `apikey ${apiKey}` },
          signal: AbortSignal.timeout(45_000),
        }),
      ]);
      if (!response.ok) {
        throw buildFeedError("sydneytrains-schedule", response.status);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const zip = new AdmZip(buffer);

      const categoryNames = new Map();
      for (const row of parseGtfsCsv(zip.readAsText("vehicle_categories.txt"))) {
        categoryNames.set(row.vehicle_category_id, row.vehicle_category_name);
      }

      const tripCategory = new Map();
      for (const row of parseGtfsCsv(zip.readAsText("trips.txt"))) {
        if (row.trip_id && row.vehicle_category_id) tripCategory.set(row.trip_id, row.vehicle_category_id);
      }

      // routes.txt's route_short_name is the real T-line number (e.g. "T1",
      // "T8") shown on real signage and third-party apps — the live feed's
      // own routeId ("NTH_2a") is just an internal schedule key with no
      // meaning to a rider.
      const routeInfo = new Map();
      for (const row of parseGtfsCsv(zip.readAsText("routes.txt"))) {
        if (row.route_id) {
          routeInfo.set(row.route_id, {
            shortName: row.route_short_name,
            longName: row.route_long_name,
            color: row.route_color,
          });
        }
      }

      sydneyTrainsFleetCache = { loadedAt: Date.now(), tripCategory, categoryNames, routeInfo };
      return sydneyTrainsFleetCache;
    })().finally(() => {
      sydneyTrainsFleetPromise = null;
    });
  }
  return sydneyTrainsFleetPromise;
}
let ptvV3Cache = { loadedAt: 0, trains: [] };
// Realtime feeds update in short bursts. Keep this cache just long enough to
// coalesce simultaneous clients, not long enough to make moving trains stale.
const LIVE_TRAIN_CACHE_MS = 4_000;
const LIVE_TRAIN_STALE_MS = 15 * 60_000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
let liveTrainCache = { loadedAt: 0, trains: [] };
let liveTrainRefreshPromise = null;
let liveTrainCooldownUntil = 0;
const NSW_SOUTHEASTERN_BOUNDS = {
  minLat: -39.8,
  maxLat: -32.0,
  minLng: 140.0,
  maxLng: 152.5,
};

const NSW_TRAINLINK_KEYWORDS = [
  "xpt",
  "xplorer",
  "trainlink",
  "southern cross",
  "sydney central",
  "albury",
  "melbourne",
  "brisbane",
  "casino",
  "dubbo",
  "armidale",
  "moree",
  "griffith",
  "canberra",
  "goulburn",
];

function readBoundsFilter(query = {}) {
  const minLat = Number(query.minLat);
  const maxLat = Number(query.maxLat);
  const minLng = Number(query.minLng);
  const maxLng = Number(query.maxLng);

  if ([minLat, maxLat, minLng, maxLng].some((value) => Number.isNaN(value))) {
    return null;
  }

  return { minLat, maxLat, minLng, maxLng };
}

function withinBounds(item, bounds) {
  if (!bounds) return true;
  return (
    item.lat >= bounds.minLat &&
    item.lat <= bounds.maxLat &&
    item.lng >= bounds.minLng &&
    item.lng <= bounds.maxLng
  );
}

function normalisePtvRouteId(routeId) {
  const routeText = String(routeId || "Metro");
  const code = routeText.match(/vic-02-([A-Z0-9]+):/i)?.[1]?.toUpperCase() ?? routeText;
  const routeMap = {
    ALM: "Alamein",
    ARA: "Ararat",
    BEG: "Belgrave",
    BAT: "Ballarat",
    BEN: "Bendigo",
    BNS: "Bairnsdale",
    CBE: "Cranbourne",
    CGB: "Craigieburn",
    ECH: "Echuca",
    FKN: "Frankston",
    GEO: "Geelong",
    GWY: "Glen Waverley",
    HBE: "Hurstbridge",
    LIL: "Lilydale",
    MBR: "Maryborough",
    MDD: "Mernda",
    PKM: "Pakenham",
    SHM: "Sandringham",
    SHL: "Swan Hill",
    SHP: "Shepparton",
    SEY: "Seymour",
    STY: "Stony Point",
    SUY: "Sunbury",
    TRN: "Traralgon",
    UFD: "Upfield",
    WAR: "Warrnambool",
    WER: "Werribee",
    WIL: "Williamstown",
  };

  return routeMap[code] ?? String(routeId || "Metro");
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return undefined;
}

function buildFeedError(sourceKey, status) {
  if (status === 429) {
    return new Error(`${sourceKey}:rate-limited`);
  }

  return new Error(`${sourceKey}:unavailable:${status}`);
}

function sanitiseFeedFailure(message) {
  if (/rate-limited|:429\b/i.test(message)) {
    return "Live train feed is rate limited. Showing cached/fallback data where available.";
  }

  if (/sydneytrains/i.test(message)) {
    return "Sydney Trains live feed is unavailable right now.";
  }

  if (/nswtrains/i.test(message)) {
    return "NSW TrainLink live feed is unavailable right now.";
  }

  if (/metro|vline/i.test(message)) {
    return "PTV live train feed is unavailable right now.";
  }

  return "Live train feed is unavailable right now.";
}

function normaliseConsistLabel(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (/^aus:vic:vic-02-[A-Z0-9]+:/i.test(trimmed)) continue;
    if (/^vic-02-[A-Z0-9]+:/i.test(trimmed)) continue;
    return trimmed;
  }

  return "Unknown";
}

function isWithinNswSoutheasternBounds(latitude, longitude) {
  return (
    latitude >= NSW_SOUTHEASTERN_BOUNDS.minLat &&
    latitude <= NSW_SOUTHEASTERN_BOUNDS.maxLat &&
    longitude >= NSW_SOUTHEASTERN_BOUNDS.minLng &&
    longitude <= NSW_SOUTHEASTERN_BOUNDS.maxLng
  );
}

function getFirstMeaningfulText(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    return trimmed;
  }

  return "";
}

function inferNswTrainLinkServiceLabel(...values) {
  const joined = values
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .toLowerCase();

  if (joined.includes("xpt")) return "NSW TrainLink XPT";
  if (joined.includes("xplorer")) return "NSW TrainLink Xplorer";
  return "NSW TrainLink XPT";
}

// The NSW feed's own vehicle label is the only field that reliably carries a
// real place name for services outside our small destinationMap keyword list
// below (e.g. "05:50pm (135)  Broadmeadow - Taree Manning Mall", "05:59pm
// Newcastle Interchange - Scone") — an optional departure time and trip
// number prefix the actual "Origin - Destination" pair. Parsing this directly
// avoids falling back to the generic "NSW TrainLink XPT" placeholder (which
// then makes the map/detail-panel code treat the vehicle as having no real
// destination at all, and guess a Melbourne-only fallback like "Flinders
// Street" that is nonsensical for an interstate NSW service).
function parseNswTrainLinkRouteFromLabel(vehicleLabel) {
  if (typeof vehicleLabel !== "string") return null;
  const match = vehicleLabel.match(/^\s*\d{1,2}:\d{2}\s*(?:am|pm)?\s*(?:\(\S+\)\s*)?(.+?)\s+-\s+(.+?)\s*$/i);
  if (!match) return null;
  const origin = match[1]?.trim();
  const destination = match[2]?.trim();
  if (!origin || !destination) return null;
  return { origin, destination };
}

function inferNswTrainLinkDestination(...values) {
  const joined = values
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .toLowerCase();

  const destinationMap = [
    ["southern cross", "Southern Cross"],
    ["sydney central", "Sydney Central"],
    ["albury", "Albury"],
    ["melbourne", "Melbourne"],
    ["brisbane", "Brisbane"],
    ["casino", "Casino"],
    ["dubbo", "Dubbo"],
    ["armidale", "Armidale"],
    ["moree", "Moree"],
    ["griffith", "Griffith"],
    ["canberra", "Canberra"],
    ["goulburn", "Goulburn"],
  ];

  for (const [needle, label] of destinationMap) {
    if (joined.includes(needle)) {
      return label;
    }
  }

  return inferNswTrainLinkServiceLabel(...values);
}

function buildNswLiveTrains(feed) {
  return (feed.entity ?? [])
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;
      if (!vehicle || !position) return null;

      const latitude = position.latitude;
      const longitude = position.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return null;
      if (!isWithinNswSoutheasternBounds(latitude, longitude)) return null;

      const routeId = vehicle.trip?.routeId;
      const tripId = vehicle.trip?.tripId;
      const tripStartDate = vehicle.trip?.startDate;
      const vehicleLabel = vehicle.vehicle?.label;
      const vehicleId = vehicle.vehicle?.id;
      const entityId = entity.id;
      const serviceLabel = inferNswTrainLinkServiceLabel(routeId, tripId, vehicleLabel, vehicleId, entityId);
      const labelRoute = parseNswTrainLinkRouteFromLabel(vehicleLabel);
      const destination = labelRoute?.destination ?? inferNswTrainLinkDestination(routeId, tripId, vehicleLabel, vehicleId, entityId);
      const origin = labelRoute?.origin;
      const timestamp = toNumber(vehicle.timestamp);
      const directionId = toNumber(vehicle.trip?.directionId);
      const tdn = getFirstMeaningfulText(vehicleLabel, tripId, vehicleId, entityId, routeId, "XPT");
      const consist = normaliseConsistLabel(vehicleLabel, vehicleId, tdn);

      const descriptiveText = [routeId, tripId, vehicleLabel, vehicleId, entityId]
        .filter((value) => typeof value === "string" && value.trim())
        .join(" ");

      const looksLikeTrainLink =
        NSW_TRAINLINK_KEYWORDS.some((keyword) => descriptiveText.toLowerCase().includes(keyword)) ||
        serviceLabel !== "NSW TrainLink";

      if (!looksLikeTrainLink) {
        return null;
      }

      return {
        tdn,
        tripId,
        lat: latitude,
        lng: longitude,
        line: serviceLabel,
        origin,
        destination,
        status: "on_time",
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
        direction: directionId === 0 ? "up" : directionId === 1 ? "down" : destination === "Southern Cross" ? "city-bound" : "outbound",
        heading: typeof position.bearing === "number" ? position.bearing : undefined,
        trainType: serviceLabel.includes("Xplorer") ? "NSW TrainLink Xplorer" : "NSW TrainLink XPT",
        consist,
        // Frontend summary parsing (getVehicleOriginFallback/getVehicleStoppingPattern
        // in Map.tsx) splits on the literal word " to " to recover origin/destination
        // from this string, matching the format used for every other line — so this
        // needs the same separator, not an arrow, for that fallback to actually apply.
        serviceDescription: origin
          ? `${origin} to ${destination}`
          : [serviceLabel, destination, tripStartDate].filter(Boolean).join(" · "),
      };
    })
    .filter(Boolean);
}

// Sydney Trains' GTFS-RT vehicle positions have no field naming the physical
// fleet class directly — vehicle.vehicle.id is an anonymised, per-request-
// rotating string (not a real set number the way Melbourne's consist numbers
// are). But Transport for NSW's own static schedule for this same product
// names the real fleet class per trip_id (vehicle_category_id, resolved via
// vehicle_categories.txt — see loadSydneyTrainsFleetLookup), and live
// trip_ids match the static schedule's exactly, so this looks the real
// class up rather than guessing one. vehicle.vehicle.label also carries a
// real, useful scheduled "HH:MM Origin Station to Destination Station"
// string, parsed here for the real origin/destination.
function buildSydneyTrainsLiveTrains(feed, fleetLookup) {
  return (feed.entity ?? [])
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;
      if (!vehicle || !position) return null;

      const latitude = position.latitude;
      const longitude = position.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return null;

      const tripId = vehicle.trip?.tripId;
      const routeId = vehicle.trip?.routeId;
      const vehicleLabel = vehicle.vehicle?.label;
      const vehicleId = vehicle.vehicle?.id;
      const labelMatch = typeof vehicleLabel === "string"
        ? vehicleLabel.match(/^\s*(\d{1,2}:\d{2})\s+(.+?)\s+to\s+(.+?)\s*$/i)
        : null;
      const origin = labelMatch?.[2]?.replace(/\s+Station$/i, "");
      const destination = labelMatch?.[3]?.replace(/\s+Station$/i, "");
      // The full trip_id ("190L.807.169.48.B.8.91072023") is an internal
      // schedule key, not something a rider recognises — its first segment
      // ("190L") is the real day trip number, the same short form real
      // Sydney apps like AnyTrip show as the trip's identifier.
      const tdn = tripId?.split(".")[0] || getFirstMeaningfulText(tripId, routeId, entity.id, "Sydney Trains");
      const consist = normaliseConsistLabel(vehicleLabel, tdn);
      const timestamp = toNumber(vehicle.timestamp);
      const directionId = toNumber(vehicle.trip?.directionId);
      const categoryId = tripId ? fleetLookup?.tripCategory.get(tripId) : undefined;
      const fleetClass = categoryId ? fleetLookup?.categoryNames.get(categoryId) : undefined;
      // route_short_name (e.g. "T1", "T8") is the real line number shown on
      // signage and third-party apps — routeId itself ("NTH_2a") is just an
      // internal schedule key with no meaning to a rider. Kept out of the
      // `line` field itself since isSydneyTrainsLiveTrain and the operator
      // lookup above match on the literal text "Sydney Trains" there.
      const routeInfo = routeId ? fleetLookup?.routeInfo.get(routeId) : undefined;

      return {
        tdn,
        tripId,
        lat: latitude,
        lng: longitude,
        line: "Sydney Trains",
        origin,
        destination: destination || "Sydney Trains",
        status: "on_time",
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
        direction: directionId === 0 ? "up" : directionId === 1 ? "down" : "outbound",
        heading: typeof position.bearing === "number" ? position.bearing : undefined,
        trainType: fleetClass ?? "Sydney Trains",
        consist,
        serviceDescription: [
          routeInfo?.shortName,
          origin && destination ? `${origin} to ${destination}` : null,
        ].filter(Boolean).join(" · ") || "Sydney Trains",
      };
    })
    .filter(Boolean);
}

function buildPtvLiveTrains(feed, source) {
  return (feed.entity ?? [])
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;
      if (!vehicle || !position) return null;

      const latitude = position.latitude;
      const longitude = position.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return null;

      const routeId = vehicle.trip?.routeId || "Metro";
      const lineName = normalisePtvRouteId(routeId);
      const resolvedLine =
        lineName && !/^vic-02-/i.test(lineName) && lineName !== routeId
          ? lineName
          : source.defaultLine;
      const directionId = toNumber(vehicle.trip?.directionId);
      const timestamp = toNumber(vehicle.timestamp);
      const label = vehicle.vehicle?.label || vehicle.vehicle?.id || entity.id || routeId;
      const consist = normaliseConsistLabel(vehicle.vehicle?.label, vehicle.vehicle?.id);
      const tripId = vehicle.trip?.tripId || undefined;
      const publishedTdn = tripId?.match(/-([A-Z]?\d+)$/i)?.[1];

      return {
        tdn: publishedTdn || label,
        tripId,
        // Some real vehicles report a trip_id in a PTV-generated namespace
        // that never matches the static schedule (e.g.
        // "vic:02BEG:_:H:vpt._Belgrave_3449_20260909") — a real gap in the
        // feed itself. The same TripDescriptor still carries real, standard
        // route_id/start_time fields refreshLiveTrains uses as a GTFS-RT
        // fallback match against the static schedule when tripId alone
        // doesn't resolve.
        rawRouteId: vehicle.trip?.routeId || undefined,
        startTime: vehicle.trip?.startTime || undefined,
        serviceDate: vehicle.trip?.startDate || new Intl.DateTimeFormat("en-CA", {
          timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date()).replace(/-/g, ""),
        vehicleId: vehicle.vehicle?.id || undefined,
        lat: latitude,
        lng: longitude,
        line: resolvedLine,
        destination: resolvedLine,
        destinationIsFallback: true,
        status: "on_time",
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
        // V/Line's own GTFS direction_id convention is the reverse of Metro's:
        // confirmed against the real static schedule (trips.txt), a Seymour-line
        // trip with direction_id 0 has trip_headsign "Seymour" (outbound, away
        // from the city) while direction_id 1 is headsign "Southern Cross"
        // (city-bound) — the opposite of Metro, where 0 is "up"/city-bound.
        // Using Metro's mapping for V/Line reported every outbound regional
        // service as city-bound, which fed straight into the unselected
        // marker's destination label showing "Southern Cross" for trains
        // that were actually heading away from it.
        direction: source.key === "vline"
          ? (directionId === 0 ? "down" : "up")
          : (directionId === 0 ? "up" : "down"),
        heading: typeof position.bearing === "number" ? position.bearing : undefined,
        trainType: source.trainType,
        consist,
        serviceDescription: resolvedLine,
      };
    })
    .filter(Boolean);
}

function buildPtvV3LiveTrains(data) {
  return (data?.runs ?? [])
    .map((run) => {
      const position = run.vehicle_position;
      const latitude = Number(position?.latitude);
      const longitude = Number(position?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      if (latitude === 0 || longitude === 0) return null;

      const destination = String(run.destination_name || "Metro service");
      const descriptor = run.vehicle_descriptor || {};
      const vehicleLabel = String(descriptor.id || descriptor.description || run.run_id || "Metro train");
      const routeLabel = normalisePtvRouteId(run.route_id || "Metro");

      return {
        tdn: vehicleLabel,
        tripId: run.run_id ? String(run.run_id) : undefined,
        lat: latitude,
        lng: longitude,
        line: routeLabel === run.route_id ? "Metro" : routeLabel,
        destination,
        status: String(run.status || "on_time").toLowerCase(),
        timestamp: new Date().toISOString(),
        direction: Number(run.direction_id) === 0 ? "up" : "down",
        heading: Number.isFinite(Number(position.bearing)) ? Number(position.bearing) : undefined,
        trainType: String(descriptor.description || "Metro Train"),
        consist: normaliseConsistLabel(descriptor.id, descriptor.description),
        serviceDescription: [routeLabel, destination].filter(Boolean).join(" · "),
        source: "PTV Timetable v3",
      };
    })
    .filter(Boolean);
}

async function fetchPtvV3LiveTrains() {
  if (Date.now() - ptvV3Cache.loadedAt < 8_000) return ptvV3Cache.trains;
  const routeData = await ptvV3Fetch("/v3/routes", { route_types: 0 });
  const routes = (routeData?.routes ?? []).filter((route) => route.route_id);
  const results = await Promise.allSettled(
    routes.map(async (route) => {
      const data = await ptvV3Fetch(`/v3/runs/route/${encodeURIComponent(route.route_id)}`, {
        expand: "VehiclePosition",
      });
      return buildPtvV3LiveTrains(data).map((train) => ({
        ...train,
        line: route.route_name || train.line,
        serviceDescription: [route.route_name, train.destination].filter(Boolean).join(" · "),
      }));
    }),
  );
  const routeFailures = results.filter((result) => result.status === "rejected");
  if (routeFailures.length) {
    console.warn(
      `[live-trains] ${routeFailures.length}/${results.length} PTV v3 route requests failed:`,
      [...new Set(routeFailures.map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason)))].join(" | "),
    );
  }
  const trains = results.filter((result) => result.status === "fulfilled").flatMap((result) => result.value);
  ptvV3Cache = { loadedAt: Date.now(), trains };
  return trains;
}

async function refreshLiveTrains({ ptvSubscriptionKey, ptvV3Configured, nswTransportApiKey }) {
  const feedRequests = [
    ...(ptvV3Configured && !ptvSubscriptionKey
      ? [fetchPtvV3LiveTrains()]
      : []),
    ...(ptvSubscriptionKey
      ? PTV_FEEDS.map(async (source) => {
          const response = await fetch(`${source.baseUrl}/vehicle-positions`, {
            headers: {
              KeyID: ptvSubscriptionKey,
              "Ocp-Apim-Subscription-Key": ptvSubscriptionKey,
            },
            signal: AbortSignal.timeout(20_000),
          });

          if (!response.ok) {
            throw buildFeedError(source.key, response.status);
          }

          const buffer = await response.arrayBuffer();
          const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
          return buildPtvLiveTrains(feed, source);
        })
      : []),
    ...(nswTransportApiKey
      ? [
          (async () => {
            const response = await fetch(NSW_TRAINS_VEHICLE_POSITIONS_URL, {
              headers: {
                Authorization: `apikey ${nswTransportApiKey}`,
                Accept: "application/x-google-protobuf",
              },
              signal: AbortSignal.timeout(20_000),
            });

            if (!response.ok) {
              throw buildFeedError("nswtrains", response.status);
            }

            const buffer = await response.arrayBuffer();
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
            return buildNswLiveTrains(feed);
          })(),
          (async () => {
            const [response, fleetLookup] = await Promise.all([
              fetch(SYDNEY_TRAINS_VEHICLE_POSITIONS_URL, {
                headers: {
                  Authorization: `apikey ${nswTransportApiKey}`,
                  Accept: "application/x-google-protobuf",
                },
                signal: AbortSignal.timeout(20_000),
              }),
              // The 12-hour cache means this almost never actually fetches
              // the (large, ~10MB) static schedule on the request path — it
              // only re-downloads it a couple of times a day.
              loadSydneyTrainsFleetLookup(nswTransportApiKey).catch((error) => {
                console.warn("[live-trains] Sydney Trains fleet lookup unavailable:", error instanceof Error ? error.message : error);
                return null;
              }),
            ]);

            if (!response.ok) {
              throw buildFeedError("sydneytrains", response.status);
            }

            const buffer = await response.arrayBuffer();
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
            return buildSydneyTrainsLiveTrains(feed, fleetLookup);
          })(),
        ]
      : []),
  ];

  const responses = await Promise.allSettled(feedRequests);
  const failures = responses.filter((result) => result.status === "rejected");
  const rateLimited = failures.some((result) => /rate-limited|:429\b/i.test(
    result.reason instanceof Error ? result.reason.message : String(result.reason),
  ));

  if (rateLimited) {
    liveTrainCooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  }

  for (const result of failures) {
    console.warn("[live-trains] feed request failed:", result.reason instanceof Error ? result.reason.message : result.reason);
  }

  const rawTrains = responses
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);
  const allocations = await loadVlineAllocations();
  const trains = await Promise.all(rawTrains.map(async (train) => {
    if (train.tripId?.startsWith("01-")) {
      train.allocation = resolveVlineAllocation(train, allocations);
      train.leadingSet = (await reportedVlineLeadingSets(train.serviceDate)).get(train.tdn) || null;
    }
    let effectiveTripId = train.tripId;
    let verifiedJourney = await getVerifiedTrainMarkerDestination(effectiveTripId);
    if (!verifiedJourney && train.rawRouteId && train.startTime) {
      const resolvedTripId = await resolveStaticTripIdByRouteAndStartTime(
        train.rawRouteId,
        train.startTime,
        train.serviceDate,
      );
      if (resolvedTripId) {
        const resolvedJourney = await getVerifiedTrainMarkerDestination(resolvedTripId);
        if (resolvedJourney) {
          effectiveTripId = resolvedTripId;
          verifiedJourney = resolvedJourney;
        }
      }
    }
    if (!verifiedJourney) return train;
    // The live feed's own direction_id has been observed to disagree with the
    // static schedule's direction_id for the very same V/Line trip_id (e.g. a
    // real Swan Hill->Southern Cross working reported as "down"/outbound when
    // the schedule and stopping pattern both confirm it is city-bound) — so
    // for V/Line, trust the verified destination (looked up from the static
    // schedule by trip_id, which is reliable) over the feed's direction_id.
    const direction = train.tripId?.startsWith("01-")
      ? /southern cross|flinders street|melbourne central|flagstaff|parliament/i.test(verifiedJourney.destination)
        ? "up"
        : "down"
      : train.direction;
    return {
      ...train,
      // When the live feed's own trip_id didn't match anything and we
      // resolved a real one by route+start-time instead, expose THAT trip_id
      // — every downstream stopping-pattern/platform lookup keys off this
      // field, so without it those would still fail even though we now know
      // the real trip.
      tripId: effectiveTripId,
      origin: verifiedJourney.origin,
      destination: verifiedJourney.destination,
      destinationIsFallback: false,
      direction,
      serviceDescription: `${train.line} · ${verifiedJourney.origin} → ${verifiedJourney.destination}`,
    };
  }));

  if (trains.length > 0) {
    liveTrainCache = { loadedAt: Date.now(), trains };
  }

  return { responses, trains };
}

// Reused by background service checks — those run on their own
// background schedule, separate from any inbound HTTP request, so it reads
// whatever this same in-memory cache already holds rather than triggering
// a second, redundant PTV fetch of its own. In practice this is fresh
// whenever the app has any real traffic (every /api/ptv/live-trains
// request refreshes it); if nobody has polled recently it can be briefly
// stale or empty, which just means that check quietly tries again next
// cycle rather than firing on stale data.
export function getFreshCachedLiveTrains() {
  return Date.now() - liveTrainCache.loadedAt <= 5 * 60_000 ? liveTrainCache.trains : [];
}

export function getCachedLiveTrains() {
  return liveTrainCache.trains;
}

// getCachedLiveTrains() alone only reflects whatever a real /api/ptv/live-trains
// request last populated — with no traffic in the last poll window that cache
// can be stale or empty. Background jobs (fleet-sighting logging) that run on
// their own timer, independent of real requests, need to actively trigger a
// refresh rather than hope someone else's request happened to warm it first.
export async function ensureLiveTrainsFresh() {
  const ptvSubscriptionKey =
    process.env.PTV_SUBSCRIPTION_KEY ||
    process.env.PTV_subscription_key ||
    process.env.OCP_APIM_SUBSCRIPTION_KEY ||
    process.env.PTV_API_KEY;
  const nswTransportApiKey =
    process.env.NSW_TRANSPORT_API_KEY ||
    process.env.TRANSPORT_NSW_API_KEY ||
    process.env.TFNSW_API_KEY ||
    process.env.NSW_OPENDATA_API_KEY;
  const ptvV3Configured = isPtvV3Configured();

  if (!ptvSubscriptionKey && !ptvV3Configured && !nswTransportApiKey) {
    return liveTrainCache.trains;
  }

  const cacheAge = Date.now() - liveTrainCache.loadedAt;
  if (liveTrainCache.trains.length > 0 && cacheAge < LIVE_TRAIN_CACHE_MS) {
    return liveTrainCache.trains;
  }

  if (Date.now() < liveTrainCooldownUntil && liveTrainCache.trains.length > 0 && cacheAge < LIVE_TRAIN_STALE_MS) {
    return liveTrainCache.trains;
  }

  if (!liveTrainRefreshPromise) {
    liveTrainRefreshPromise = refreshLiveTrains({ ptvSubscriptionKey, ptvV3Configured, nswTransportApiKey }).finally(() => {
      liveTrainRefreshPromise = null;
    });
  }

  try {
    await liveTrainRefreshPromise;
  } catch (error) {
    console.warn("[live-trains] background refresh failed:", error?.message ?? error);
  }

  return liveTrainCache.trains;
}

export default async function handler(req, res) {
  const ptvSubscriptionKey =
    process.env.PTV_SUBSCRIPTION_KEY ||
    process.env.PTV_subscription_key ||
    process.env.OCP_APIM_SUBSCRIPTION_KEY ||
    process.env.PTV_API_KEY;
  const nswTransportApiKey =
    process.env.NSW_TRANSPORT_API_KEY ||
    process.env.TRANSPORT_NSW_API_KEY ||
    process.env.TFNSW_API_KEY ||
    process.env.NSW_OPENDATA_API_KEY;
  const ptvV3Configured = isPtvV3Configured();

  if (!ptvSubscriptionKey && !ptvV3Configured && !nswTransportApiKey) {
    res.status(503).json({
      error: "Live train positions need a Transport Victoria KeyID. The installed GTFS timetable remains available for scheduled departures.",
      code: "PTV_KEY_REQUIRED",
      trains: [],
    });
    return;
  }

  try {
    const bounds = readBoundsFilter(req.query ?? {});
    const cacheAge = Date.now() - liveTrainCache.loadedAt;
    if (liveTrainCache.trains.length > 0 && cacheAge < LIVE_TRAIN_CACHE_MS) {
      res.status(200).json({
        trains: liveTrainCache.trains.filter((train) => withinBounds(train, bounds)),
        cached: true,
      });
      return;
    }

    if (Date.now() < liveTrainCooldownUntil && liveTrainCache.trains.length > 0 && cacheAge < LIVE_TRAIN_STALE_MS) {
      res.status(200).json({
        trains: liveTrainCache.trains.filter((train) => withinBounds(train, bounds)),
        cached: true,
        stale: true,
        warning: "Live train feed is temporarily rate limited; showing the last verified positions.",
      });
      return;
    }

    if (!liveTrainRefreshPromise) {
      liveTrainRefreshPromise = refreshLiveTrains({ ptvSubscriptionKey, ptvV3Configured, nswTransportApiKey })
        .finally(() => {
          liveTrainRefreshPromise = null;
        });
    }

    const { responses, trains } = await liveTrainRefreshPromise;
    const fulfilled = trains.filter((train) => withinBounds(train, bounds));

    if (fulfilled.length > 0) {
      res.status(200).json({ trains: fulfilled, cached: false });
      return;
    }

    if (liveTrainCache.trains.length > 0 && Date.now() - liveTrainCache.loadedAt < LIVE_TRAIN_STALE_MS) {
      res.status(200).json({
        trains: liveTrainCache.trains.filter((train) => withinBounds(train, bounds)),
        cached: true,
        stale: true,
        warning: "Live feeds are unavailable; showing the last verified positions.",
      });
      return;
    }

    const failureMessage = responses
      .filter((result) => result.status === "rejected")
      .map((result) => sanitiseFeedFailure(result.reason instanceof Error ? result.reason.message : "Unknown feed error"))
      .filter((message, index, messages) => messages.indexOf(message) === index)
      .join(" | ");

    res.status(502).json({
      error: failureMessage || "Failed to load live trains",
    });
    return;
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load live trains",
    });
  }
}
import { loadVlineAllocations, resolveVlineAllocation } from "../_lib/vline-allocations.js";
import { reportedVlineLeadingSets } from "../_lib/vline-public-data.js";
