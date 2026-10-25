import fs from "node:fs";
import { groupTrainWorkings, neighbouringTrainWorkings } from "./train-workings.js";
import { getNonPassengerPassThroughs } from "./freight-timing-data.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { isPtvV3Configured, ptvV3Fetch } from "./ptv-v3.js";
import { mergeSharedTrainPlatforms, resolveTrainPlatformDetails } from "./train-platforms.js";
import { getVlineDeparturePlatform, enrichVlinePlatforms } from "./vline-platforms.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_GTFS_PATH = path.join(REPO_ROOT, ".local-host", "gtfs.zip");
const BUS_STOP_TIMES_PATH = path.join(REPO_ROOT, ".local-host", "gtfs-bus", "stop_times.txt");
const BUS_STOP_INDEX_PATH = path.join(REPO_ROOT, ".local-host", "gtfs-bus", "stop-times-index.json");
const BUS_SHAPES_PATH = path.join(REPO_ROOT, ".local-host", "gtfs-bus", "shapes.txt");
const BUS_SHAPES_INDEX_PATH = path.join(REPO_ROOT, ".local-host", "gtfs-bus", "shapes-index.json");
const STOP_HEADSIGNS_PATH = path.join(REPO_ROOT, ".local-host", "gtfs-bus", "stop-headsigns.json");
const METRO_REALTIME_URL =
  "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro";
const VLINE_REALTIME_URL =
  "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/vline";
const BUS_REALTIME_URL =
  "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/bus";
const TRAM_REALTIME_URL =
  "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/tram";
const TIME_ZONE = "Australia/Melbourne";
// A real physical train needs at least this long at a terminus to detrain,
// get a new TDN assigned, and depart again (see the formation-linking use
// below) — anything faster means two independent trips just share a block_id.
const MINIMUM_REALISTIC_TURNAROUND_SECONDS = 60;
const realtimeCache = new Map();
let timetablePromise;
let busStopIndex;
let busShapeIndex;
let stopHeadsignIndex;

// PTV's live departures API resolves a lat/lng to whichever real-time stop
// is NEAREST within 500m (see getVerifiedSurfaceStopDepartures below) — for
// two closely-spaced physical stops serving opposite directions of the same
// route (e.g. a shelter on each side of a road, both real GTFS stops but
// sharing one live PTV timepoint), that collapses both directions onto
// whichever physical stop a rider actually tapped. Confirmed live: real
// stop_id 16209 ("Luntar Rd/Centre Rd") only ever has westbound "Middle
// Brighton" trips in the static schedule, its neighbour 17615 (same name,
// ~125m east) only ever has eastbound "Blackburn" ones, yet both showed
// both directions before this filter existed. Real headsigns per exact
// static stop_id, built by .local-host/build-bus-stop-headsigns-index.mjs.
function getKnownHeadsignsForStop(stopId) {
  if (!stopId || !fs.existsSync(STOP_HEADSIGNS_PATH)) return null;
  stopHeadsignIndex ||= JSON.parse(fs.readFileSync(STOP_HEADSIGNS_PATH, "utf8"));
  return stopHeadsignIndex[stopId] ?? null;
}
let trainMarkerDestinationsPromise;
let tripStartIndexPromise;

export function readIndexedBusStopTimes(tripId) {
  if (!fs.existsSync(BUS_STOP_TIMES_PATH) || !fs.existsSync(BUS_STOP_INDEX_PATH)) return [];
  busStopIndex ||= JSON.parse(fs.readFileSync(BUS_STOP_INDEX_PATH, "utf8"));
  const range = busStopIndex[tripId];
  if (!range) return [];
  const [start, end] = range;
  const buffer = Buffer.allocUnsafe(end - start);
  const descriptor = fs.openSync(BUS_STOP_TIMES_PATH, "r");
  try {
    fs.readSync(descriptor, buffer, 0, buffer.length, start);
  } finally {
    fs.closeSync(descriptor);
  }
  const rows = [];
  forEachCsvRow(`trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type,shape_dist_traveled\n${buffer.toString("utf8")}`, (row) => {
    rows.push({
      tripId: row.trip_id,
      stopId: row.stop_id,
      arrivalTime: row.arrival_time,
      departureTime: row.departure_time,
      stopSequence: Number(row.stop_sequence),
      stopHeadsign: row.stop_headsign || undefined,
      pickupType: row.pickup_type,
    });
  });
  return rows.sort((left, right) => left.stopSequence - right.stopSequence);
}

// Melbourne's real bus GTFS shapes.txt is 90MB+ (every route's actual
// road-following geometry, tens of thousands of points) — reading it whole
// into memory to serve one journey leg's single shape would be wasteful.
// Same byte-offset-index-and-seek approach already used for bus stop_times
// above: a route's shape rows are all contiguous in the real file (verified
// directly against this feed — every shape_id appears as exactly one
// unbroken block, never scattered), so one seek + one read covers it.
export function readIndexedBusShape(shapeId) {
  if (!shapeId || !fs.existsSync(BUS_SHAPES_PATH) || !fs.existsSync(BUS_SHAPES_INDEX_PATH)) return [];
  busShapeIndex ||= JSON.parse(fs.readFileSync(BUS_SHAPES_INDEX_PATH, "utf8"));
  const range = busShapeIndex[shapeId];
  if (!range) return [];
  const [start, end] = range;
  const buffer = Buffer.allocUnsafe(end - start);
  const descriptor = fs.openSync(BUS_SHAPES_PATH, "r");
  try {
    fs.readSync(descriptor, buffer, 0, buffer.length, start);
  } finally {
    fs.closeSync(descriptor);
  }
  const points = [];
  forEachCsvRow(`shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n${buffer.toString("utf8")}`, (row) => {
    const lat = Number(row.shape_pt_lat);
    const lng = Number(row.shape_pt_lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      points.push({ lat, lng, sequence: Number(row.shape_pt_sequence) });
    }
  });
  return points.sort((left, right) => left.sequence - right.sequence).map((point) => [point.lat, point.lng]);
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function forEachCsvRow(text, callback) {
  let headers;
  let start = 0;
  let rowIndex = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text.charCodeAt(index) !== 10) continue;
    const rawLine = text.slice(start, index).replace(/\r$/, "");
    start = index + 1;
    if (!rawLine) continue;
    const values = parseCsvLine(rawLine);
    if (rowIndex === 0) {
      headers = values.map((header) => header.replace(/^\uFEFF/, ""));
    } else {
      const row = {};
      headers.forEach((header, headerIndex) => {
        row[header] = values[headerIndex] ?? "";
      });
      callback(row);
    }
    rowIndex += 1;
  }
}

function readNestedText(outerZip, folder, filename) {
  const nestedEntry = outerZip.getEntry(`${folder}/google_transit.zip`);
  if (!nestedEntry) throw new Error(`Official GTFS folder ${folder} is missing.`);
  const nestedZip = new AdmZip(nestedEntry.getData());
  const entry = nestedZip.getEntry(filename);
  if (!entry) throw new Error(`Official GTFS file ${folder}/${filename} is missing.`);
  return entry.getData().toString("utf8");
}

export function normaliseStationName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\brailway station\b|\bstation\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildModeIndex(outerZip, folder, includeStopTimes) {
  const stops = new Map();
  const stopIdsByName = new Map();
  const routes = new Map();
  const trips = new Map();
  const calendar = new Map();
  const exceptions = new Map();
  const stopTimesByStop = new Map();
  const stopTimesByTrip = new Map();

  forEachCsvRow(readNestedText(outerZip, folder, "stops.txt"), (row) => {
    const stop = {
      id: row.stop_id,
      name: row.stop_name,
      code: row.stop_code || undefined,
      ptvStopId: row.stop_url?.match(/\/stop\/(\d+)/)?.[1],
      platform: row.platform_code || undefined,
      parentStation: row.parent_station || undefined,
      lat: Number(row.stop_lat),
      lng: Number(row.stop_lon),
    };
    stops.set(stop.id, stop);
    const key = normaliseStationName(stop.name);
    if (!stopIdsByName.has(key)) stopIdsByName.set(key, []);
    stopIdsByName.get(key).push(stop.id);
  });

  forEachCsvRow(readNestedText(outerZip, folder, "routes.txt"), (row) => {
    routes.set(row.route_id, {
      shortName: row.route_short_name,
      longName: row.route_long_name,
      type: row.route_type,
      color: row.route_color,
    });
  });

  forEachCsvRow(readNestedText(outerZip, folder, "trips.txt"), (row) => {
    trips.set(row.trip_id, {
      id: row.trip_id,
      routeId: row.route_id,
      serviceId: row.service_id,
      blockId: row.block_id || undefined,
      destination: row.trip_headsign,
      directionId: row.direction_id,
      shapeId: row.shape_id || undefined,
    });
  });

  forEachCsvRow(readNestedText(outerZip, folder, "calendar.txt"), (row) => {
    calendar.set(row.service_id, row);
  });

  forEachCsvRow(readNestedText(outerZip, folder, "calendar_dates.txt"), (row) => {
    const key = `${row.date}:${row.service_id}`;
    exceptions.set(key, Number(row.exception_type));
  });

  if (includeStopTimes) {
    forEachCsvRow(readNestedText(outerZip, folder, "stop_times.txt"), (row) => {
      if (!stopTimesByStop.has(row.stop_id)) stopTimesByStop.set(row.stop_id, []);
      const stopTime = {
        tripId: row.trip_id,
        stopId: row.stop_id,
        arrivalTime: row.arrival_time,
        departureTime: row.departure_time,
        stopSequence: Number(row.stop_sequence),
        stopHeadsign: row.stop_headsign || undefined,
        pickupType: row.pickup_type,
        dropOffType: row.drop_off_type,
      };
      stopTimesByStop.get(row.stop_id).push(stopTime);
      if (!stopTimesByTrip.has(row.trip_id)) stopTimesByTrip.set(row.trip_id, []);
      stopTimesByTrip.get(row.trip_id).push(stopTime);
    });
  }

  return { stops, stopIdsByName, routes, trips, calendar, exceptions, stopTimesByStop, stopTimesByTrip };
}

export async function loadTimetable() {
  if (!timetablePromise) {
    timetablePromise = Promise.resolve().then(() => {
      const gtfsPath = process.env.GTFS_SCHEDULE_PATH || DEFAULT_GTFS_PATH;
      if (!fs.existsSync(gtfsPath)) {
        throw new Error("Official GTFS schedule archive is not installed on this host.");
      }
      const stats = fs.statSync(gtfsPath);
      const outerZip = new AdmZip(gtfsPath);
      const train = buildModeIndex(outerZip, "2", true);
      const regionalTrain = buildModeIndex(outerZip, "1", true);
      mergeSharedTrainPlatforms(regionalTrain.stops, train.stops);
      return {
        train,
        regionalTrain,
        tram: buildModeIndex(outerZip, "3", true),
        // Bus stop_times.txt is too large to materialise as one JS string.
        // Bus trip stops are supplied by the official realtime trip-update feed.
        bus: buildModeIndex(outerZip, "4", false),
        scheduleUpdatedAt: stats.mtime.toISOString(),
      };
    }).catch((error) => {
      timetablePromise = undefined;
      throw error;
    });
  }
  return timetablePromise;
}

function getMelbourneDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function getServiceDate(date = new Date()) {
  const parts = getMelbourneDateParts(date);
  return `${parts.year}${parts.month}${parts.day}`;
}

function getPreviousServiceDate() {
  return getServiceDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

function getOffsetMinutes(year, month, day) {
  const zoneName = new Intl.DateTimeFormat("en-AU", {
    timeZone: TIME_ZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(Date.UTC(year, month - 1, day, 12)))
    .find((part) => part.type === "timeZoneName")?.value;
  const match = zoneName?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 600;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

function gtfsTimeToDate(serviceDate, gtfsTime) {
  const year = Number(serviceDate.slice(0, 4));
  const month = Number(serviceDate.slice(4, 6));
  const day = Number(serviceDate.slice(6, 8));
  const [hours, minutes, seconds] = gtfsTime.split(":").map(Number);
  const offsetMinutes = getOffsetMinutes(year, month, day);
  return new Date(
    Date.UTC(year, month - 1, day, hours, minutes, seconds || 0) - offsetMinutes * 60_000,
  );
}

function isServiceActive(mode, serviceId, serviceDate) {
  const exception = mode.exceptions.get(`${serviceDate}:${serviceId}`);
  if (exception === 1) return true;
  if (exception === 2) return false;
  const entry = mode.calendar.get(serviceId);
  if (!entry || serviceDate < entry.start_date || serviceDate > entry.end_date) return false;
  const date = new Date(
    Date.UTC(Number(serviceDate.slice(0, 4)), Number(serviceDate.slice(4, 6)) - 1, Number(serviceDate.slice(6, 8))),
  );
  const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getUTCDay()];
  return entry[weekday] === "1";
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value.toNumber === "function") return value.toNumber();
  return 0;
}

async function fetchRealtimeFeed(baseUrl, pathName) {
  const key =
    process.env.PTV_SUBSCRIPTION_KEY ||
    process.env.PTV_subscription_key ||
    process.env.OCP_APIM_SUBSCRIPTION_KEY ||
    process.env.PTV_API_KEY;
  if (!key) throw new Error("PTV subscription key is not configured.");
  const cacheKey = `${baseUrl}${pathName}`;
  const cached = realtimeCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < 25_000) return cached.feed;
  const response = await fetch(cacheKey, {
    headers: { KeyID: key, "Ocp-Apim-Subscription-Key": key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Official PTV realtime feed failed (${response.status}).`);
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(await response.arrayBuffer()),
  );
  realtimeCache.set(cacheKey, { loadedAt: Date.now(), feed });
  return feed;
}

function buildRealtimeTripMap(feed) {
  return new Map(
    (feed.entity || [])
      .filter((entity) => entity.tripUpdate?.trip?.tripId)
      .map((entity) => [entity.tripUpdate.trip.tripId, entity.tripUpdate]),
  );
}

// TripUpdate entities never carry a vehicle identity (PTV's bus feed leaves
// that field null on every trip-update) — the only place a trip_id can be
// tied to one physical vehicle is the separate vehicle-positions feed. A
// schedule block_id says two trips were PLANNED to run back-to-back on the
// same bus, but real-world relief vehicles and depot swaps break that plan
// often enough that it can't be trusted on its own — this is what let two
// unrelated buses (different number plates) get shown as one "previous
// service"/"next service" of each other. Cross-checking the live vehicle
// identity for both trips is the only way to confirm it's really the same
// bus rather than just the same planned block.
function buildRealtimeVehicleIdentityMap(feed) {
  return new Map(
    (feed.entity || [])
      .filter((entity) => entity.vehicle?.trip?.tripId)
      .map((entity) => [
        entity.vehicle.trip.tripId,
        entity.vehicle.vehicle?.licensePlate || entity.vehicle.vehicle?.id || undefined,
      ])
      .filter(([, identity]) => Boolean(identity)),
  );
}

// For "the same physical train formed both legs" merging of cancellation
// notices (Metro Tunnel services can split their TDN at Anzac while
// continuing as one consist). Returns a block_id ONLY when the station+time
// resolves to exactly one active scheduled trip with a block_id — any
// ambiguity (0 or 2+ distinct blocks) returns undefined so callers don't
// merge on a guess.
export async function findMetroTrainBlockId(stationName, clockTimeText, serviceDate = getServiceDate()) {
  const match = String(clockTimeText || "").trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)?$/i);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  const targetPrefix = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  const timetable = await loadTimetable();
  const stationKey = normaliseStationName(stationName);
  const stopIds = timetable.train.stopIdsByName.get(stationKey) || [];
  if (!stopIds.length) return undefined;

  const candidates = new Set();
  for (const stopId of stopIds) {
    for (const stopTime of timetable.train.stopTimesByStop.get(stopId) || []) {
      const time = stopTime.departureTime || stopTime.arrivalTime;
      if (!time?.startsWith(targetPrefix)) continue;
      const trip = timetable.train.trips.get(stopTime.tripId);
      if (!trip?.blockId || !isServiceActive(timetable.train, trip.serviceId, serviceDate)) continue;
      candidates.add(trip.blockId);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

// Same station+time matching as findMetroTrainBlockId, but returns the exact
// scheduled trip_id itself (only when unambiguous) so a caller can look up
// the TDN or the block-chained true origin/destination for that specific
// working, rather than just knowing which physical train it belongs to.
export async function findMetroTrainTrip(stationName, clockTimeText, serviceDate = getServiceDate()) {
  const match = String(clockTimeText || "").trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)?$/i);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  const targetPrefix = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  const timetable = await loadTimetable();
  const stationKey = normaliseStationName(stationName);
  const stopIds = timetable.train.stopIdsByName.get(stationKey) || [];
  if (!stopIds.length) return undefined;

  const candidates = new Set();
  for (const stopId of stopIds) {
    for (const stopTime of timetable.train.stopTimesByStop.get(stopId) || []) {
      const time = stopTime.departureTime || stopTime.arrivalTime;
      if (!time?.startsWith(targetPrefix)) continue;
      const trip = timetable.train.trips.get(stopTime.tripId);
      if (!trip || !isServiceActive(timetable.train, trip.serviceId, serviceDate)) continue;
      candidates.add(stopTime.tripId);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

export async function getVerifiedStationDepartures(stationName) {
  const timetable = await loadTimetable();
  const stationKey = normaliseStationName(stationName);
  const trainModes = [
    { mode: timetable.train, realtimeUrl: METRO_REALTIME_URL },
    { mode: timetable.regionalTrain, realtimeUrl: VLINE_REALTIME_URL },
  ].filter(({ mode }) => (mode.stopIdsByName.get(stationKey) || []).length > 0);
  if (trainModes.length === 0) {
    return { stationName, departures: [], error: "Station not found in the official GTFS schedule." };
  }

  await Promise.all(trainModes.map(async (entry) => {
    try {
      entry.realtimeFeed = await fetchRealtimeFeed(entry.realtimeUrl, "/trip-updates");
    } catch {
      entry.realtimeFeed = null;
    }
    entry.realtimeTrips = entry.realtimeFeed ? buildRealtimeTripMap(entry.realtimeFeed) : new Map();
  }));
  const now = Date.now();
  const windowEnd = now + 3 * 60 * 60 * 1000;
  const departures = [];
  const seenTrips = new Set();
  let stationPosition = null;

  for (const serviceDate of [getPreviousServiceDate(), getServiceDate()]) {
    for (const { mode: trainMode, realtimeTrips } of trainModes) {
      for (const stopId of trainMode.stopIdsByName.get(stationKey) || []) {
       const stop = trainMode.stops.get(stopId);
       if (!stationPosition && typeof stop?.lat === "number" && typeof stop?.lng === "number") {
         stationPosition = [stop.lat, stop.lng];
       }
       for (const stopTime of trainMode.stopTimesByStop.get(stopId) || []) {
        const trip = trainMode.trips.get(stopTime.tripId);
        if (!trip || seenTrips.has(trip.id) || !isServiceActive(trainMode, trip.serviceId, serviceDate)) continue;
        const scheduledDate = gtfsTimeToDate(serviceDate, stopTime.departureTime || stopTime.arrivalTime);
        const realtimeTrip = realtimeTrips.get(trip.id);
        const realtimeStop = realtimeTrip?.stopTimeUpdate?.find(
          (update) => update.stopId === stopId || toNumber(update.stopSequence) === stopTime.stopSequence,
        );
        const realtimeSeconds = toNumber(realtimeStop?.departure?.time || realtimeStop?.arrival?.time);
        const expectedDate = realtimeSeconds ? new Date(realtimeSeconds * 1000) : scheduledDate;
        // The live feed's trip_id carries no date, so a trip whose calendar is
        // active on both scanned service dates (the common case for any daily
        // service) can get its live position matched while scanning the WRONG
        // day — pairing a correct live time with a scheduledDate exactly one
        // calendar day off. That showed up as a bogus "1440 min late". Skip
        // (without marking seenTrips) so the correctly-dated pass can still
        // claim this trip instead of being locked out by the mismatched one.
        if (realtimeSeconds && Math.abs(expectedDate.getTime() - scheduledDate.getTime()) > 3 * 60 * 60 * 1000) continue;
        // A service stays on the board for a couple of minutes after it's
        // left rather than vanishing the instant it departs — riders walking
        // up to a platform still want to see "that one just left" briefly.
        if (expectedDate.getTime() < now - 2 * 60_000 || expectedDate.getTime() > windowEnd) continue;
        seenTrips.add(trip.id);
        const route = trainMode.routes.get(trip.routeId);
        const tripRelationship = toNumber(realtimeTrip?.trip?.scheduleRelationship);
        const stopRelationship = toNumber(realtimeStop?.scheduleRelationship);
        departures.push({
          tripId: trip.id,
          route: route?.shortName || route?.longName || "Metro",
          destination: stopTime.stopHeadsign || trip.destination || "Destination unavailable",
          ...resolveTrainPlatformDetails(stop, realtimeStop, trainMode.stops, undefined, trainMode === timetable.regionalTrain ? { tripDestination: trip.destination, routeId: trip.routeId } : undefined),
          stopId,
          scheduledAt: scheduledDate.toISOString(),
          expectedAt: expectedDate.toISOString(),
          status: tripRelationship === 3 ? "cancelled" : stopRelationship === 1 ? "skipped" : realtimeSeconds ? "live" : "scheduled",
          delaySeconds: realtimeSeconds ? Math.round((expectedDate.getTime() - scheduledDate.getTime()) / 1000) : undefined,
          serviceDate,
        });
       }
      }
    }
  }

  departures.sort((left, right) => Date.parse(left.expectedAt) - Date.parse(right.expectedAt));
  const visibleDepartures = departures.slice(0, 12);
  await Promise.all(visibleDepartures.map(async (departure) => {
    const mode = timetable.regionalTrain;
    const trip = mode.trips.get(departure.tripId);
    if (!trip) return;
    const platform = await getVlineDeparturePlatform(mode.stops.get(departure.stopId), trip, departure.scheduledAt);
    if (platform) Object.assign(departure, { platform, platformSource: "LIVE" });
  }));
  // Computed from a fully separate, non-GTFS data source and never merged
  // into `departures` — freight/heritage/empty-car pass-throughs must never
  // affect the real passenger sort/slice/next-departure logic above.
  const nonPassengerPassThroughs = stationPosition
    ? getNonPassengerPassThroughs(stationName, stationPosition)
    : [];
  return {
    stationName,
    departures: visibleDepartures,
    nonPassengerPassThroughs,
    generatedAt: new Date().toISOString(),
    realtimeFeedAt: Math.max(...trainModes.map(({ realtimeFeed }) => toNumber(realtimeFeed?.header?.timestamp)), 0)
      ? new Date(Math.max(...trainModes.map(({ realtimeFeed }) => toNumber(realtimeFeed?.header?.timestamp))) * 1000).toISOString()
      : undefined,
    scheduleUpdatedAt: timetable.scheduleUpdatedAt,
    source: trainModes.some(({ realtimeFeed }) => realtimeFeed)
      ? "Transport Victoria GTFS Schedule + GTFS-Realtime"
      : "Transport Victoria GTFS Schedule",
  };
}

function resolveScheduledTripId(mode, requestedId, serviceDate) {
  const exact = mode.trips.get(requestedId);
  if (exact && isServiceActive(mode, exact.serviceId, serviceDate)) return requestedId;
  const parts = requestedId.match(/^(\d+-[^-]+)--\d+-[^-]+-([A-Z]?\d+)$/i);
  if (!parts) return exact ? requestedId : undefined;
  const candidates = [...mode.trips.values()].filter((candidate) =>
    candidate.id.startsWith(`${parts[1]}--`) && candidate.id.endsWith(`-${parts[2]}`) &&
    isServiceActive(mode, candidate.serviceId, serviceDate));
  // Never pick an arbitrary timetable revision when more than one is active.
  return candidates.length === 1 ? candidates[0].id : exact ? requestedId : undefined;
}

export async function getVerifiedTrainTrip(tripId) {
  if (!tripId || tripId.length > 200) throw new Error("A valid train trip ID is required.");
  const timetable = await loadTimetable();
  const requestedTripId = tripId;
  const isRegionalTrip = /^01-/.test(tripId) || timetable.regionalTrain.trips.has(tripId);
  const trainMode = isRegionalTrip ? timetable.regionalTrain : timetable.train;

  let realtimeFeed = null;
  try {
    realtimeFeed = await fetchRealtimeFeed(isRegionalTrip ? VLINE_REALTIME_URL : METRO_REALTIME_URL, "/trip-updates");
  } catch {
    // The static dated schedule still provides verified times and platforms.
  }
  const realtimeTrip = realtimeFeed ? buildRealtimeTripMap(realtimeFeed).get(requestedTripId) : undefined;
  const serviceDate = realtimeTrip?.trip?.startDate || getServiceDate();
  tripId = resolveScheduledTripId(trainMode, requestedTripId, serviceDate) || requestedTripId;
  const trip = trainMode.trips.get(tripId);
  // This endpoint only ever knows Victoria's own schedule (Metro + V/Line).
  // A tripId from another state's feed (Sydney Trains, NSW TrainLink) is
  // never in trainMode.trips, but every call site below builds its segment
  // from whatever it's given regardless of whether the trip was actually
  // found — so an unmatched tripId used to fabricate a placeholder segment
  // (blank origin/destination "Unknown origin → Unknown destination", "Time
  // TBC", the raw tripId re-shown as if it were a real TDN) instead of
  // reporting plainly that this trip isn't in this schedule at all.
  if (!trip) {
    return {
      tripId: requestedTripId,
      scheduledTripId: undefined,
      nextServices: [],
      route: undefined,
      destination: undefined,
      segmentTripIds: [],
      segments: [],
      formationSegments: [],
      stops: [],
      previousFormationStatus: "unknown",
      nextFormationStatus: "unknown",
      source: null,
    };
  }
  const route = trainMode.routes.get(trip.routeId);
  const now = Date.now();

  const realtimeTrips = realtimeFeed ? buildRealtimeTripMap(realtimeFeed) : new Map();
  if (realtimeTrip) realtimeTrips.set(tripId, realtimeTrip);
  const buildStops = (targetTripId) => {
    const targetRealtimeTrip = realtimeTrips.get(targetTripId);
    const targetTrip = trainMode.trips.get(targetTripId);
    const targetTripDestination = targetTrip?.destination;
    return (trainMode.stopTimesByTrip.get(targetTripId) || [])
    .sort((left, right) => left.stopSequence - right.stopSequence)
    .map((stopTime) => {
      const stop = trainMode.stops.get(stopTime.stopId);
      const realtimeStop = targetRealtimeTrip?.stopTimeUpdate?.find(
        (update) => update.stopId === stopTime.stopId || toNumber(update.stopSequence) === stopTime.stopSequence,
      );
      const scheduledArrival = gtfsTimeToDate(serviceDate, stopTime.arrivalTime || stopTime.departureTime);
      const scheduledDeparture = gtfsTimeToDate(serviceDate, stopTime.departureTime || stopTime.arrivalTime);
      const realtimeArrivalSeconds = toNumber(realtimeStop?.arrival?.time);
      const realtimeDepartureSeconds = toNumber(realtimeStop?.departure?.time);
      const expectedArrival = realtimeArrivalSeconds ? new Date(realtimeArrivalSeconds * 1000) : scheduledArrival;
      const expectedDeparture = realtimeDepartureSeconds ? new Date(realtimeDepartureSeconds * 1000) : scheduledDeparture;
      const delaySeconds = Math.round((expectedDeparture.getTime() - scheduledDeparture.getTime()) / 1000);
      const dwellSeconds = Math.max(0, Math.round((expectedDeparture.getTime() - expectedArrival.getTime()) / 1000));
      const relationship = toNumber(realtimeStop?.scheduleRelationship);

      return {
        stopId: stopTime.stopId,
        stopSequence: stopTime.stopSequence,
        name: stop?.name || `PTV stop ${stopTime.stopId}`,
        // GTFS pickup_type/drop_off_type: "1" means not offered at this stop.
        pickupType: stopTime.pickupType === "1" ? "none" : undefined,
        dropOffType: stopTime.dropOffType === "1" ? "none" : undefined,
        ...resolveTrainPlatformDetails(stop, realtimeStop, trainMode.stops, undefined, isRegionalTrip ? { tripDestination: targetTripDestination, routeId: targetTrip?.routeId } : undefined),
        lat: Number.isFinite(stop?.lat) ? stop.lat : undefined,
        lng: Number.isFinite(stop?.lng) ? stop.lng : undefined,
        scheduledArrivalAt: scheduledArrival.toISOString(),
        scheduledDepartureAt: scheduledDeparture.toISOString(),
        expectedArrivalAt: expectedArrival.toISOString(),
        expectedDepartureAt: expectedDeparture.toISOString(),
        delaySeconds,
        dwellSeconds,
        status: relationship === 1 ? "skipped" : expectedDeparture.getTime() < now ? "passed" : "upcoming",
      };
    });
  };

  const ownStopTimes = (trainMode.stopTimesByTrip.get(tripId) || []).sort(
    (left, right) => left.stopSequence - right.stopSequence,
  );
  const firstOwnStop = ownStopTimes[0];
  const lastOwnStop = ownStopTimes.at(-1);
  const isTownHallStop = (stopTime) =>
    normaliseStationName(trainMode.stops.get(stopTime?.stopId)?.name) === "town hall";
  const sameHandoverTime = (left, right) =>
    (left?.departureTime || left?.arrivalTime) === (right?.arrivalTime || right?.departureTime);
  const normaliseDestination = (value) =>
    String(value || "").toLowerCase().replace(/\s+via\s+metro tunnel.*$/i, "").trim();

  let precedingTripId;
  let continuationTripId;
  let previousFormationTripId;
  let nextFormationTripId;
  let bestPreviousGap = Number.POSITIVE_INFINITY;
  let bestNextGap = Number.POSITIVE_INFINITY;
  // Whether ANY other trip on this same physical block runs earlier/later
  // today, regardless of whether it matched the strict same-platform check
  // above. Lets us tell "this block genuinely has no further/earlier working
  // today" (confidently show as empty) apart from "there's a working out
  // there but we can't confidently identify which one" (hide, don't guess).
  let anyEarlierBlockCandidate = false;
  let anyLaterBlockCandidate = false;
  const gtfsSeconds = (value) => {
    const [hours, minutes, seconds] = String(value || "").split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) && Number.isFinite(seconds)
      ? hours * 3600 + minutes * 60 + seconds
      : Number.NaN;
  };
  if (trip && firstOwnStop && lastOwnStop) {
    for (const [candidateTripId, unsortedCandidateStops] of trainMode.stopTimesByTrip) {
      if (candidateTripId === tripId) continue;
      const candidateTrip = trainMode.trips.get(candidateTripId);
      if (!candidateTrip || candidateTrip.serviceId !== trip.serviceId) continue;
      const candidateStops = [...unsortedCandidateStops].sort((left, right) => left.stopSequence - right.stopSequence);
      const candidateFirst = candidateStops[0];
      const candidateLast = candidateStops.at(-1);

      if (trip.blockId && candidateTrip.blockId === trip.blockId) {
        const candidateEndSeconds = gtfsSeconds(candidateLast?.arrivalTime || candidateLast?.departureTime);
        const candidateStartSeconds = gtfsSeconds(candidateFirst?.departureTime || candidateFirst?.arrivalTime);
        const ownStartSeconds = gtfsSeconds(firstOwnStop.departureTime || firstOwnStop.arrivalTime);
        const ownEndSeconds = gtfsSeconds(lastOwnStop.arrivalTime || lastOwnStop.departureTime);
        if (Number.isFinite(candidateEndSeconds) && candidateEndSeconds <= ownStartSeconds) anyEarlierBlockCandidate = true;
        if (Number.isFinite(candidateStartSeconds) && candidateStartSeconds >= ownEndSeconds) anyLaterBlockCandidate = true;

        // A real physical train needs at least a minute to detrain, get a new
        // TDN assigned, and depart again. A 0-second (or near-0) gap at the
        // same platform means these are two independent trips that happen to
        // share a block_id in the schedule data, not the same train
        // continuing straight on — most often a same-platform reversal at a
        // terminus. Flattening that into one timeline shows the stopping
        // pattern going out and doubling back through the same stations.
        // Treat it as a distinct next/previous service instead (see
        // nextServices below), not part of this trip's own stop list.
        // There's deliberately no upper bound on the gap: this candidate is
        // already confirmed via a shared block_id at the exact handover
        // station, and the smallest-gap match is kept, so a longer real-world
        // layover (a train stabled for hours between peak duties is normal)
        // is still the correct link, not something to discard as unconfirmed.
        if (candidateLast?.stopId === firstOwnStop.stopId) {
          const gap = gtfsSeconds(firstOwnStop.departureTime || firstOwnStop.arrivalTime) - gtfsSeconds(candidateLast.arrivalTime || candidateLast.departureTime);
          if (gap >= MINIMUM_REALISTIC_TURNAROUND_SECONDS && gap < bestPreviousGap) {
            previousFormationTripId = candidateTripId;
            bestPreviousGap = gap;
          }
        }
        if (candidateFirst?.stopId === lastOwnStop.stopId) {
          const gap = gtfsSeconds(candidateFirst.departureTime || candidateFirst.arrivalTime) - gtfsSeconds(lastOwnStop.arrivalTime || lastOwnStop.departureTime);
          if (gap >= MINIMUM_REALISTIC_TURNAROUND_SECONDS && gap < bestNextGap) {
            nextFormationTripId = candidateTripId;
            bestNextGap = gap;
          }
        }
      }

      if (
        isTownHallStop(lastOwnStop) &&
        candidateFirst?.stopId === lastOwnStop.stopId &&
        sameHandoverTime(lastOwnStop, candidateFirst) &&
        normaliseDestination(candidateTrip.destination) === normaliseDestination(trip.destination)
      ) {
        continuationTripId = candidateTripId;
      }

      if (
        isTownHallStop(firstOwnStop) &&
        candidateLast?.stopId === firstOwnStop.stopId &&
        sameHandoverTime(candidateLast, firstOwnStop) &&
        normaliseDestination(candidateTrip.destination) === normaliseDestination(trip.destination)
      ) {
        precedingTripId = candidateTripId;
      }
    }
  }

  const segmentTripIds = [precedingTripId, tripId, continuationTripId].filter(Boolean);
  const buildSegment = (segmentTripId) => {
    const segmentTrip = trainMode.trips.get(segmentTripId);
    const segmentRoute = segmentTrip ? trainMode.routes.get(segmentTrip.routeId) : undefined;
    const segmentStops = buildStops(segmentTripId);
    return {
      tripId: segmentTripId,
      tdn: segmentTripId.match(/-([A-Z]?\d+)$/i)?.[1] || segmentTripId,
      route: segmentRoute?.shortName || segmentRoute?.longName,
      direction: segmentTrip?.directionId === "1" ? "UP" : "DOWN",
      origin: segmentStops[0]?.name,
      destination: segmentStops.at(-1)?.name,
      departsAt: segmentStops[0]?.expectedDepartureAt,
      arrivesAt: segmentStops.at(-1)?.expectedArrivalAt,
      stops: segmentStops,
    };
  };
  const segments = segmentTripIds.map(buildSegment);
  const nextServices = trip?.blockId && lastOwnStop
    ? [...trainMode.trips.values()]
        .filter((candidate) => candidate.id !== tripId && candidate.blockId === trip.blockId &&
          isServiceActive(trainMode, candidate.serviceId, serviceDate))
        .map((candidate) => buildSegment(candidate.id))
        .filter((segment) => segment.departsAt &&
          Date.parse(segment.departsAt) >= gtfsTimeToDate(serviceDate, lastOwnStop.arrivalTime || lastOwnStop.departureTime).getTime())
        .sort((a, b) => Date.parse(a.departsAt) - Date.parse(b.departsAt))
    : [];
  const formationTripIds = Array.from(new Set([previousFormationTripId, ...segmentTripIds, nextFormationTripId].filter(Boolean)));
  const formationSegments = formationTripIds.map(buildSegment);
  const activeSegments = [...trainMode.trips.values()]
    .filter((candidate) => isServiceActive(trainMode, candidate.serviceId, serviceDate))
    .flatMap((candidate) => {
      const times = trainMode.stopTimesByTrip.get(candidate.id) || [];
      const first = times[0];
      const last = times.at(-1);
      if (!first || !last) return [];
      return [{
        tripId: candidate.id, blockId: candidate.blockId,
        origin: trainMode.stops.get(first.stopId)?.name,
        destination: trainMode.stops.get(last.stopId)?.name,
        originStopId: first.stopId, destinationStopId: last.stopId,
        direction: candidate.directionId,
        scheduledDepartsAt: gtfsTimeToDate(serviceDate, first.departureTime || first.arrivalTime).toISOString(),
        scheduledArrivesAt: gtfsTimeToDate(serviceDate, last.arrivalTime || last.departureTime).toISOString(),
      }];
    }).sort((a, b) => Date.parse(a.scheduledDepartsAt) - Date.parse(b.scheduledDepartsAt));
  const blocks = new Map();
  for (const segment of activeSegments) {
    const key = segment.blockId || segment.tripId;
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(segment);
  }
  const allWorkings = [...blocks.values()].flatMap(groupTrainWorkings);
  const selectedWorkings = neighbouringTrainWorkings(allWorkings, tripId);
  const serviceWorkings = selectedWorkings.length ? selectedWorkings.map((working) => ({
    ...working,
    segments: working.segments.map((segment) => {
      const { stops: _stops, ...detail } = buildSegment(segment.tripId);
      return detail;
    }),
  })) : undefined;
  // "linked" = we found the actual next/previous working. "stabled" = we
  // checked every trip on this same physical block and confirmed none runs
  // earlier/later today, so the train genuinely enters/leaves service here
  // (a real, checked fact, not a guess). "unknown" = no block_id to check, or
  // some other trip on the block exists but didn't match closely enough to
  // be confident which one — hide rather than guess in that case.
  const previousFormationStatus = previousFormationTripId
    ? "linked"
    : trip?.blockId && !anyEarlierBlockCandidate ? "stabled" : "unknown";
  const nextFormationStatus = nextFormationTripId
    ? "linked"
    : trip?.blockId && !anyLaterBlockCandidate ? "stabled" : "unknown";
  // A City Loop out-and-back (e.g. Frankston -> Flinders Street -> Frankston
  // on a different TDN) links up here the same way a genuine same-direction
  // through-run does (both share a real block_id), but flattening it into one
  // timeline would show the train travelling to Flinders Street then
  // immediately continuing back out to where it just came from — a confusing
  // "through-ran" pattern, not a real single trip's stopping pattern. Detect
  // that reversal (formation's first origin === its last destination) and
  // fall back to just this trip's own immediate segments in that case.
  const formationIsSameTerminusRoundTrip =
    Boolean(formationSegments[0]?.origin) &&
    normaliseStationName(formationSegments[0]?.origin ?? "") === normaliseStationName(formationSegments.at(-1)?.destination ?? "");
  const stopsSourceSegments = formationIsSameTerminusRoundTrip ? segments : formationSegments;
  // The public TDN may change while the physical train continues. Build the
  // visible timeline from the full linked formation so "show prior stops"
  // includes stations served before that TDN boundary. Deduplicate any shared
  // handover station generically (Town Hall, Flinders Street, or elsewhere).
  const stops = stopsSourceSegments.flatMap((segment, segmentIndex, allSegments) => {
    const segmentStops = segment.stops;
    if (segmentIndex === 0 || segmentStops.length === 0) return segmentStops;
    const previousLastStop = allSegments[segmentIndex - 1]?.stops.at(-1)?.name;
    const currentFirstStop = segmentStops[0]?.name;
    return previousLastStop && currentFirstStop
      && normaliseStationName(previousLastStop) === normaliseStationName(currentFirstStop)
      ? segmentStops.slice(1)
      : segmentStops;
  }).map((stop, index) => ({ ...stop, stopSequence: index + 1 }));
  const finalTrip = trainMode.trips.get(continuationTripId || tripId);
  if (isRegionalTrip) await enrichVlinePlatforms(stops, trainMode, trip);

  return {
    tripId: requestedTripId,
    scheduledTripId: tripId,
    nextServices: nextServices.map(({ stops: _stops, ...segment }) => ({ ...segment, source: "SCHEDULED" })),
    route: route?.shortName || route?.longName,
    destination: finalTrip?.destination || trip?.destination,
    segmentTripIds,
    segments: segments.map(({ stops: _stops, ...segment }) => segment),
    formationSegments: formationSegments.map(({ stops: _stops, ...segment }) => segment),
    serviceWorkings,
    previousWorkingStatus: "unknown",
    nextWorkingStatus: "unknown",
    previousFormationStatus,
    nextFormationStatus,
    handover: segmentTripIds.length > 1
      ? {
          station: "Town Hall",
          fromTripId: precedingTripId || tripId,
          toTripId: continuationTripId || tripId,
        }
      : undefined,
    serviceDate,
    stops,
    generatedAt: new Date().toISOString(),
    realtimeFeedAt: toNumber(realtimeFeed?.header?.timestamp)
      ? new Date(toNumber(realtimeFeed.header.timestamp) * 1000).toISOString()
      : undefined,
    scheduleUpdatedAt: timetable.scheduleUpdatedAt,
    source: realtimeTrip
      ? "Transport Victoria GTFS Schedule + GTFS-Realtime"
      : "Transport Victoria GTFS Schedule",
  };
}

// Populates `destinations` for one GTFS mode (Metro or V/Line — they're
// separate static schedules with their own trips/stops/blocks, so each is
// processed independently rather than mixed together). This used to run for
// Metro only; V/Line trip_ids never resolved here at all, so every V/Line
// vehicle relied solely on the live feed's own direction_id, which has been
// observed to disagree with the static schedule for the very same trip_id.
// Running this for V/Line too gives it the same reliable, static-schedule-
// verified destination Metro already had.
function collectTrainMarkerDestinations(mode, destinations) {
  const groups = new Map();
  const seconds = (value) => {
    const [hours, minutes, secs] = String(value || "").split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) && Number.isFinite(secs)
      ? hours * 3600 + minutes * 60 + secs
      : Number.NaN;
  };
  const tripRows = (id) => [...(mode.stopTimesByTrip.get(id) || [])]
    .sort((left, right) => left.stopSequence - right.stopSequence);

  for (const [id, trip] of mode.trips) {
    const rows = tripRows(id);
    if (!rows.length) continue;
    const first = rows[0];
    const last = rows.at(-1);
    const originStop = mode.stops.get(first.stopId)?.name;
    const finalStop = mode.stops.get(last.stopId)?.name;
    destinations.set(id, {
      origin: (originStop || "").replace(/\s+Station$/i, ""),
      destination: (trip.destination || finalStop || "").replace(/\s+Station$/i, ""),
    });
    if (!trip.blockId) continue;
    const key = trip.blockId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id, trip, rows, first, last });
  }

  for (const group of groups.values()) {
    group.sort((left, right) => seconds(left.first.departureTime || left.first.arrivalTime) - seconds(right.first.departureTime || right.first.arrivalTime));
    for (const current of group) {
      const currentStart = seconds(current.first.departureTime || current.first.arrivalTime);
      const previous = group.find((candidate) => {
        if (candidate.id === current.id || candidate.last.stopId !== current.first.stopId) return false;
        const gap = currentStart - seconds(candidate.last.arrivalTime || candidate.last.departureTime);
        return gap >= 0 && gap <= 3600;
      });
      if (previous) {
        const previousOrigin = mode.stops.get(previous.first.stopId)?.name;
        const currentJourney = destinations.get(current.id);
        if (previousOrigin && currentJourney) {
          destinations.set(current.id, {
            ...currentJourney,
            origin: previousOrigin.replace(/\s+Station$/i, ""),
          });
        }
      }
      const currentEnd = seconds(current.last.arrivalTime || current.last.departureTime);
      const next = group.find((candidate) => {
        if (candidate.id === current.id || candidate.first.stopId !== current.last.stopId) return false;
        const gap = seconds(candidate.first.departureTime || candidate.first.arrivalTime) - currentEnd;
        return gap >= 0 && gap <= 3600;
      });
      if (!next) continue;
      const finalStop = mode.stops.get(next.last.stopId)?.name;
      const finalDestination = (next.trip.destination || finalStop || "")
        .replace(/\s+Station$/i, "")
        .replace(/\s+via\s+.+$/i, "");
      const interchange = (mode.stops.get(current.last.stopId)?.name || "").replace(/\s+Station$/i, "");
      const usesCityLoop = current.rows.some((row) => /^(parliament|melbourne central|flagstaff)$/i.test(
        (mode.stops.get(row.stopId)?.name || "").replace(/\s+Station$/i, ""),
      ));
      const currentOrigin = (mode.stops.get(current.first.stopId)?.name || "").replace(/\s+Station$/i, "");
      const currentDestination = `${interchange}${usesCityLoop ? " via City Loop" : ""}`;
      // A same-terminus round trip (e.g. Frankston -> City -> back to
      // Frankston later the same day) would otherwise chain this leg's
      // real, immediate direction-aware destination onto the day's
      // eventual return stop, collapsing down to a nonsensical
      // "Frankston via City Loop" label on the unselected marker even
      // while the train is genuinely city-bound right now. Keep this
      // leg's own destination instead of chaining when that happens.
      const isSameTerminusRoundTrip = finalDestination
        && normaliseStationName(finalDestination) === normaliseStationName(currentOrigin);
      if (finalDestination && !isSameTerminusRoundTrip) {
        destinations.set(current.id, {
          origin: currentOrigin,
          destination: `${currentDestination} → ${finalDestination}`,
        });
      } else if (isSameTerminusRoundTrip) {
        destinations.set(current.id, {
          origin: currentOrigin,
          destination: currentDestination,
        });
      }
    }
  }
  return destinations;
}

export async function getVerifiedTrainMarkerDestination(tripId) {
  if (!tripId) return undefined;
  if (!trainMarkerDestinationsPromise) {
    trainMarkerDestinationsPromise = loadTimetable().then((timetable) => {
      const destinations = new Map();
      collectTrainMarkerDestinations(timetable.train, destinations);
      collectTrainMarkerDestinations(timetable.regionalTrain, destinations);
      return destinations;
    });
  }
  return (await trainMarkerDestinationsPromise).get(tripId);
}

// Some real Metro vehicles report a trip_id in an entirely different, PTV-
// generated namespace ("vic:02BEG:_:H:vpt._Belgrave_3449_20260909") that
// never matches the static schedule's own trip_id format at all — a real gap
// in the live feed itself, not a bug in our matching. But the same
// TripDescriptor that carries that unmatched trip_id also carries real,
// structured route_id/start_time fields (standard GTFS-RT), which the
// standard GTFS-RT fallback technique uses to resolve the real scheduled
// trip: a route only ever has one trip starting at a given stop at a given
// time on a given service day, so route_id + start_time (matched against
// each candidate trip's own first stop_time, filtered to services actually
// running that day) identifies it unambiguously.
async function getTripStartIndex() {
  if (!tripStartIndexPromise) {
    tripStartIndexPromise = loadTimetable().then((timetable) => {
      const index = new Map();
      const addMode = (mode) => {
        for (const [id, trip] of mode.trips) {
          const rows = mode.stopTimesByTrip.get(id);
          if (!rows?.length) continue;
          const first = [...rows].sort((left, right) => left.stopSequence - right.stopSequence)[0];
          const startTime = first.departureTime || first.arrivalTime;
          if (!startTime) continue;
          const key = `${trip.routeId}|${startTime}`;
          if (!index.has(key)) index.set(key, []);
          index.get(key).push({ id, serviceId: trip.serviceId, mode });
        }
      };
      addMode(timetable.train);
      addMode(timetable.regionalTrain);
      return index;
    });
  }
  return tripStartIndexPromise;
}

export async function resolveStaticTripIdByRouteAndStartTime(routeId, startTime, serviceDate) {
  if (!routeId || !startTime) return undefined;
  const index = await getTripStartIndex();
  const candidates = index.get(`${routeId}|${startTime}`);
  if (!candidates?.length) return undefined;
  const active = serviceDate
    ? candidates.filter((candidate) => isServiceActive(candidate.mode, candidate.serviceId, serviceDate))
    : candidates;
  // Ambiguous (more than one real candidate) is treated the same as no
  // match — guessing between two real trips is still a guess.
  return active.length === 1 ? active[0].id : undefined;
}

function squaredDistance(left, right) {
  return (left.lat - right.lat) ** 2 + (left.lng - right.lng) ** 2;
}

// Map stop markers do not carry a PTV ID. Resolve them against the official
// GTFS stop coordinates before asking the Timetable API for departures.
function findNearestOfficialStop(mode, { route, lat, lng }) {
  const requestedRoute = String(route || "").trim().toLowerCase();
  const target = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return null;

  let nearest = null;
  for (const stop of mode.stops.values()) {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) continue;
    const distance = squaredDistance(stop, target);
    if (!nearest || distance < nearest.distance) nearest = { stop, distance };
  }
  if (!nearest || nearest.distance > 0.0036) return null; // ~6 km, guards invalid map points

  // A nearby GTFS stop can serve several routes. The v3 response is filtered
  // below; this fast route check avoids returning an unrelated stop when there
  // are parallel corridors.
  if (!requestedRoute) return nearest.stop;
  return nearest.stop;
}

export async function getVerifiedSurfaceStopDepartures({ mode: modeName, route, lat, lng }) {
  const modeKey = String(modeName || "").toLowerCase() === "tram" ? "tram" : "bus";
  const routeType = modeKey === "tram" ? 1 : 2;
  if (!isPtvV3Configured()) {
    throw new Error("PTV timetable credentials are not configured.");
  }
  const timetable = await loadTimetable();
  const stop = findNearestOfficialStop(timetable[modeKey], { route, lat, lng });
  if (!stop) throw new Error("This map stop could not be matched to an official PTV stop.");

  // Static GTFS stop_ids are not the numeric stop_ids accepted by PTV v3.
  // Resolve the same physical platform through the location endpoint, keeping
  // the GTFS id in our response while using the v3 id only for the API call.
  const requestedRoute = String(route || "").trim().toLowerCase();
  const nearby = await ptvV3Fetch(`/v3/stops/location/${Number(lat)},${Number(lng)}`, {
    route_types: routeType,
    max_results: 20,
    max_distance: 500,
  });
  const nearbyStops = Array.isArray(nearby.stops) ? nearby.stops : [];
  const ptvStop = nearbyStops
    .filter((candidate) => !requestedRoute || (candidate.routes || []).some((candidateRoute) =>
      String(candidateRoute.route_number || candidateRoute.route_name || "").trim().toLowerCase() === requestedRoute,
    ))
    .sort((left, right) => Number(left.stop_distance || 0) - Number(right.stop_distance || 0))[0];
  if (!ptvStop?.stop_id) throw new Error("This GTFS stop could not be matched to a PTV timetable stop for the selected route.");

  const data = await ptvV3Fetch(`/v3/departures/route_type/${routeType}/stop/${encodeURIComponent(ptvStop.stop_id)}`, {
    max_results: 30,
    include_cancelled: true,
    expand: "route,direction,run",
  });
  const collectionValues = (value) => Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
  const routeItems = [...collectionValues(data.routes), ...(ptvStop.routes || [])];
  const routes = new Map(routeItems.map((item) => [String(item.route_id), item]));
  const requestedRouteInfo = routeItems.find((item) =>
    String(item.route_number || item.route_name || "").trim().toLowerCase() === requestedRoute,
  );
  let directionItems = collectionValues(data.directions);
  if (directionItems.length === 0 && requestedRouteInfo?.route_id) {
    const directionData = await ptvV3Fetch(`/v3/directions/route/${encodeURIComponent(requestedRouteInfo.route_id)}`);
    directionItems = collectionValues(directionData.directions);
  }
  const directions = new Map(directionItems.map((item) => [String(item.direction_id), item]));
  // A multi-route interchange bay (no `route` filter — every route serving
  // this exact stop) can return departures for several distinct routes, but
  // PTV's own departures response only inlines direction data for some of
  // them. A direction lookup miss below used to silently fall back to the
  // whole bidirectional route name (e.g. "828 to Hampton - Berwick
  // Station", a real route's two different termini glued together, not a
  // real single-direction destination) — backfill directions for every
  // route_id actually present in the departures, not just the one route
  // this call happened to be scoped to.
  const missingRouteIds = [...new Set((data.departures || []).map((departure) => String(departure.route_id)))]
    .filter((routeId) => ![...directions.values()].some((direction) => String(direction.route_id) === routeId));
  await Promise.all(missingRouteIds.map(async (routeId) => {
    const directionData = await ptvV3Fetch(`/v3/directions/route/${encodeURIComponent(routeId)}`).catch(() => null);
    for (const item of collectionValues(directionData?.directions)) {
      directions.set(String(item.direction_id), item);
    }
  }));
  const departures = (data.departures || [])
    .map((departure) => {
      const routeInfo = routes.get(String(departure.route_id));
      const routeLabel = String(routeInfo?.route_number || routeInfo?.route_name || departure.route_id || "");
      const direction = directions.get(String(departure.direction_id));
      return {
        route: routeLabel,
        // routeInfo.route_name is the WHOLE route's own name spanning both
        // termini (e.g. "Fountain Gate SC - Hampton via Berwick Station") —
        // showing that as if it were this one departure's single-direction
        // destination reads as nonsense ("828 to Hampton - Berwick
        // Station"). Better to say plainly that the real destination isn't
        // known yet than to display a wrong-looking one.
        destination: direction?.direction_name || "Destination unavailable",
        // PTV occasionally publishes a live estimate without its scheduled
        // timestamp. Keep the client contract valid and treat the estimate as
        // the baseline in that case, rather than serialising a missing date.
        scheduledAt: departure.scheduled_timetable_utc || departure.estimated_departure_utc,
        expectedAt: departure.estimated_departure_utc || departure.scheduled_timetable_utc,
        status: departure.cancelled ? "cancelled" : departure.estimated_departure_utc ? "live" : "scheduled",
        platform: departure.platform_number || undefined,
        runId: departure.run_id || undefined,
      };
    })
    .filter((departure) => !requestedRoute || departure.route.toLowerCase() === requestedRoute)
    .filter((departure) => {
      // Drop a direction the real static schedule never assigns to this
      // exact physical stop (see getKnownHeadsignsForStop above) — this is
      // what actually separates two closely-spaced, identically-named stops
      // that PTV's live lookup otherwise merges into one. No index data for
      // this stop, or an unresolved destination, is never treated as a
      // reason to hide a departure.
      const knownHeadsigns = getKnownHeadsignsForStop(stop.id);
      if (!knownHeadsigns || knownHeadsigns.length === 0) return true;
      const destination = departure.destination.toLowerCase();
      if (destination === "destination unavailable") return true;
      return knownHeadsigns.some((headsign) => {
        const normalised = headsign.toLowerCase();
        return normalised.includes(destination) || destination.includes(normalised);
      });
    })
    .filter((departure) => departure.expectedAt)
    .sort((left, right) => Date.parse(left.expectedAt) - Date.parse(right.expectedAt))
    .slice(0, 12);

  return {
    stopId: stop.id,
    stopName: String(ptvStop.stop_name || stop.name).trim(),
    route: String(route || ""),
    departures,
    generatedAt: new Date().toISOString(),
    source: "Public Transport Victoria Timetable API",
  };
}

// Tram vehicle positions carry a GTFS trip ID, so use the same official
// schedule and trip-update sources as buses. This deliberately returns every
// stop in the run; the client decides which earlier stops to collapse.
export async function getVerifiedTramTrip(requestedTripId) {
  if (!requestedTripId || requestedTripId.length > 200) throw new Error("A valid tram trip ID is required.");
  const timetable = await loadTimetable();
  let feed = null;
  try {
    feed = await fetchRealtimeFeed(TRAM_REALTIME_URL, "/trip-updates");
  } catch {
    // The official static schedule still supplies the complete stop pattern.
  }

  const update = feed ? buildRealtimeTripMap(feed).get(requestedTripId) : undefined;
  const serviceDate = update?.trip?.startDate || getServiceDate();
  // The realtime feed's own trip_id (e.g. "03-64--7-T5-142612701") often uses a
  // different middle segment than the static schedule's matching trip
  // (e.g. "03-64--5-T5-142612701") — same route and run number, different
  // service-pattern index. Trains already resolve this; trams need the same
  // fuzzy match or almost every live tram fails the direct lookup below.
  const tripId = resolveScheduledTripId(timetable.tram, requestedTripId, serviceDate) || requestedTripId;
  const trip = timetable.tram.trips.get(tripId);
  const route = trip ? timetable.tram.routes.get(trip.routeId) : undefined;
  const now = Date.now();
  const realtimeBySequence = new Map(
    (update?.stopTimeUpdate || []).map((stopUpdate) => [toNumber(stopUpdate.stopSequence), stopUpdate]),
  );
  const scheduledStopTimes = (timetable.tram.stopTimesByTrip.get(tripId) || [])
    .sort((left, right) => left.stopSequence - right.stopSequence);
  if (!trip && scheduledStopTimes.length === 0) {
    throw new Error("This live tram has not published a matching scheduled trip.");
  }

  const stops = scheduledStopTimes.map((stopTime) => {
    const stopUpdate = realtimeBySequence.get(stopTime.stopSequence) ||
      update?.stopTimeUpdate?.find((candidate) => candidate.stopId === stopTime.stopId);
    const stop = timetable.tram.stops.get(stopTime.stopId);
    const eventSeconds = toNumber(stopUpdate?.departure?.time || stopUpdate?.arrival?.time);
    const scheduledDate = gtfsTimeToDate(serviceDate, stopTime.departureTime || stopTime.arrivalTime);
    const expectedDate = eventSeconds ? new Date(eventSeconds * 1000) : scheduledDate;
    return {
      stopId: stopTime.stopId,
      stopSequence: stopTime.stopSequence,
      name: stop?.name || `PTV stop ${stopTime.stopId}`,
      stopCode: stop?.code,
      lat: Number.isFinite(stop?.lat) ? stop.lat : undefined,
      lng: Number.isFinite(stop?.lng) ? stop.lng : undefined,
      expectedAt: expectedDate.toISOString(),
      status: toNumber(stopUpdate?.scheduleRelationship) === 1
        ? "skipped"
        : expectedDate.getTime() < now
          ? "passed"
          : "upcoming",
    };
  });

  // Tram GTFS almost never populates block_id (unlike trains/buses), so a
  // physical tram's next working can't be traced via a shared block. Instead,
  // treat it as the same physical tram reversing at a terminus when another
  // trip on the SAME route and service day starts exactly where this one
  // ends (or ends exactly where this one starts), within a realistic
  // turnaround window — the same "stop continuity" evidence used elsewhere
  // in this file for terminus reversals, just without a block_id to confirm
  // it, so this is reported as inferred rather than as verified fact.
  const ownFirstStop = scheduledStopTimes[0];
  const ownLastStop = scheduledStopTimes.at(-1);
  let previousFormation;
  let nextFormation;
  let previousGap = Number.POSITIVE_INFINITY;
  let nextGap = Number.POSITIVE_INFINITY;

  if (trip && ownFirstStop && ownLastStop) {
    const ownStart = gtfsTimeToDate(serviceDate, ownFirstStop.departureTime || ownFirstStop.arrivalTime)?.getTime();
    const ownEnd = gtfsTimeToDate(serviceDate, ownLastStop.arrivalTime || ownLastStop.departureTime)?.getTime();

    for (const [candidateTripId, candidateTrip] of timetable.tram.trips) {
      if (
        candidateTripId === tripId ||
        candidateTrip.routeId !== trip.routeId ||
        candidateTrip.serviceId !== trip.serviceId ||
        !isServiceActive(timetable.tram, candidateTrip.serviceId, serviceDate)
      ) continue;

      const candidateStops = (timetable.tram.stopTimesByTrip.get(candidateTripId) || [])
        .sort((left, right) => left.stopSequence - right.stopSequence);
      const candidateFirst = candidateStops[0];
      const candidateLast = candidateStops.at(-1);
      if (!candidateFirst || !candidateLast) continue;

      if (candidateLast.stopId === ownFirstStop.stopId) {
        const candidateEnd = gtfsTimeToDate(serviceDate, candidateLast.arrivalTime || candidateLast.departureTime)?.getTime();
        const gap = Number.isFinite(candidateEnd) && Number.isFinite(ownStart) ? ownStart - candidateEnd : NaN;
        if (gap >= MINIMUM_REALISTIC_TURNAROUND_SECONDS * 1000 && gap <= 45 * 60_000 && gap < previousGap) {
          previousFormation = { tripId: candidateTripId, trip: candidateTrip, first: candidateFirst, last: candidateLast };
          previousGap = gap;
        }
      }
      if (candidateFirst.stopId === ownLastStop.stopId) {
        const candidateStart = gtfsTimeToDate(serviceDate, candidateFirst.departureTime || candidateFirst.arrivalTime)?.getTime();
        const gap = Number.isFinite(candidateStart) && Number.isFinite(ownEnd) ? candidateStart - ownEnd : NaN;
        if (gap >= MINIMUM_REALISTIC_TURNAROUND_SECONDS * 1000 && gap <= 45 * 60_000 && gap < nextGap) {
          nextFormation = { tripId: candidateTripId, trip: candidateTrip, first: candidateFirst, last: candidateLast };
          nextGap = gap;
        }
      }
    }
  }

  const buildTramFormationSegment = (candidate) => {
    const candidateRoute = timetable.tram.routes.get(candidate.trip.routeId);
    const departsAt = gtfsTimeToDate(serviceDate, candidate.first.departureTime || candidate.first.arrivalTime);
    const arrivesAt = gtfsTimeToDate(serviceDate, candidate.last.arrivalTime || candidate.last.departureTime);
    return {
      tripId: candidate.tripId,
      route: candidateRoute?.shortName || candidateRoute?.longName,
      origin: timetable.tram.stops.get(candidate.first.stopId)?.name,
      destination: candidate.trip.destination || timetable.tram.stops.get(candidate.last.stopId)?.name,
      departsAt: departsAt?.toISOString(),
      arrivesAt: arrivesAt?.toISOString(),
    };
  };
  const formationSegments = [previousFormation, nextFormation].filter(Boolean).map(buildTramFormationSegment);

  return {
    tripId: requestedTripId,
    scheduledTripId: tripId,
    route: route?.shortName || route?.longName || update?.trip?.routeId,
    destination: trip?.destination,
    stops,
    formationSegments,
    generatedAt: new Date().toISOString(),
    realtimeFeedAt: toNumber(feed?.header?.timestamp)
      ? new Date(toNumber(feed.header.timestamp) * 1000).toISOString()
      : undefined,
    scheduleUpdatedAt: timetable.scheduleUpdatedAt,
    source: update
      ? "Transport Victoria GTFS Schedule + GTFS-Realtime"
      : "Transport Victoria GTFS Schedule",
  };
}

export async function getVerifiedBusTrip(requestedTripId) {
  if (!requestedTripId || requestedTripId.length > 160) throw new Error("A valid PTV trip ID is required.");
  const timetable = await loadTimetable();
  let feed = null;
  let vehicleIdentityByTripId = new Map();
  try {
    feed = await fetchRealtimeFeed(BUS_REALTIME_URL, "/trip-updates");
  } catch {
    // A dated GTFS schedule remains useful and verified when realtime is late.
  }
  try {
    const vehiclePositionsFeed = await fetchRealtimeFeed(BUS_REALTIME_URL, "/vehicle-positions");
    vehicleIdentityByTripId = buildRealtimeVehicleIdentityMap(vehiclePositionsFeed);
  } catch {
    // Without this, formation-linking below stays conservative (no vehicle
    // identity to confirm continuity with, so no previous/next is claimed).
  }
  const update = feed ? buildRealtimeTripMap(feed).get(requestedTripId) : undefined;
  const serviceDate = update?.trip?.startDate || getServiceDate();
  // Same realtime-vs-static trip_id mismatch as trains/trams: the live feed's
  // middle segment can differ from the static schedule's matching trip.
  const tripId = resolveScheduledTripId(timetable.bus, requestedTripId, serviceDate) || requestedTripId;
  const trip = timetable.bus.trips.get(tripId);
  const route = trip ? timetable.bus.routes.get(trip.routeId) : undefined;
  const now = Date.now();
  const realtimeBySequence = new Map(
    (update?.stopTimeUpdate || []).map((stopUpdate) => [toNumber(stopUpdate.stopSequence), stopUpdate]),
  );
  const scheduledStopTimes = (timetable.bus.stopTimesByTrip.get(tripId) || readIndexedBusStopTimes(tripId))
    .sort((left, right) => left.stopSequence - right.stopSequence);
  const stopRows = scheduledStopTimes.length
    ? scheduledStopTimes
    : (update?.stopTimeUpdate || []).map((stopUpdate) => ({
        stopId: stopUpdate.stopId,
        stopSequence: toNumber(stopUpdate.stopSequence),
        arrivalTime: "",
        departureTime: "",
      }));

  const stops = stopRows
    .map((stopTime) => {
      const stopUpdate = realtimeBySequence.get(stopTime.stopSequence) ||
        update?.stopTimeUpdate?.find((candidate) => candidate.stopId === stopTime.stopId);
      const stop = timetable.bus.stops.get(stopTime.stopId);
      const eventSeconds = toNumber(stopUpdate?.departure?.time || stopUpdate?.arrival?.time);
      const scheduledDate = stopTime.departureTime || stopTime.arrivalTime
        ? gtfsTimeToDate(serviceDate, stopTime.departureTime || stopTime.arrivalTime)
        : null;
      const expectedDate = eventSeconds ? new Date(eventSeconds * 1000) : scheduledDate;
      return {
        stopId: stopTime.stopId,
        stopSequence: stopTime.stopSequence,
        name: stop?.name || `PTV stop ${stopTime.stopId}`,
        stopCode: stop?.code,
        lat: Number.isFinite(stop?.lat) ? stop.lat : undefined,
        lng: Number.isFinite(stop?.lng) ? stop.lng : undefined,
        expectedAt: expectedDate?.toISOString(),
        status: toNumber(stopUpdate?.scheduleRelationship) === 1
          ? "skipped"
          : expectedDate && expectedDate.getTime() < now
            ? "passed"
            : "upcoming",
      };
    })
    // Keep the full published pattern. The client hides older stops by default
    // but can reveal them; dropping them here made completed/stale-feed trips
    // appear to have no data at all.
    .filter(Boolean);

  const currentTrip = timetable.bus.trips.get(tripId);
  const tripUpdates = feed ? buildRealtimeTripMap(feed) : new Map();
  const eventTime = (event) => {
    const seconds = toNumber(event?.departure?.time || event?.arrival?.time);
    return seconds ? seconds * 1000 : Number.NaN;
  };
  const updateBounds = (tripUpdate) => {
    const rows = [...(tripUpdate?.stopTimeUpdate || [])]
      .filter((row) => row.stopId)
      .sort((left, right) => toNumber(left.stopSequence) - toNumber(right.stopSequence));
    return { first: rows[0], last: rows.at(-1) };
  };
  const ownBounds = updateBounds(update);
  let previousFormation;
  let nextFormation;
  let previousGap = Number.POSITIVE_INFINITY;
  let nextGap = Number.POSITIVE_INFINITY;

  // A block_id match only says the schedule PLANNED these two trips for the
  // same bus — require the live vehicle-positions feed to confirm the same
  // physical vehicle (by number plate/fleet id) actually ran both, since
  // relief vehicles and depot swaps mean that plan doesn't always hold.
  const ownVehicleIdentity = vehicleIdentityByTripId.get(requestedTripId);
  if (currentTrip?.blockId && update && ownVehicleIdentity) {
    for (const [candidateTripId, candidateUpdate] of tripUpdates) {
      if (candidateTripId === tripId) continue;
      const candidateTrip = timetable.bus.trips.get(candidateTripId);
      if (!candidateTrip || candidateTrip.blockId !== currentTrip.blockId || candidateTrip.serviceId !== currentTrip.serviceId) continue;
      if (vehicleIdentityByTripId.get(candidateTripId) !== ownVehicleIdentity) continue;
      const candidateBounds = updateBounds(candidateUpdate);

      if (candidateBounds.last?.stopId === ownBounds.first?.stopId) {
        const gap = eventTime(ownBounds.first) - eventTime(candidateBounds.last);
        if (gap >= 0 && gap <= 90 * 60_000 && gap < previousGap) {
          previousFormation = { tripId: candidateTripId, trip: candidateTrip, update: candidateUpdate, bounds: candidateBounds };
          previousGap = gap;
        }
      }
      if (candidateBounds.first?.stopId === ownBounds.last?.stopId) {
        const gap = eventTime(candidateBounds.first) - eventTime(ownBounds.last);
        if (gap >= 0 && gap <= 90 * 60_000 && gap < nextGap) {
          nextFormation = { tripId: candidateTripId, trip: candidateTrip, update: candidateUpdate, bounds: candidateBounds };
          nextGap = gap;
        }
      }
    }
  }

  const formationSegment = ({ tripId: segmentTripId, trip: segmentTrip, bounds }) => {
    const segmentRoute = timetable.bus.routes.get(segmentTrip.routeId);
    const firstStop = timetable.bus.stops.get(bounds.first?.stopId);
    const lastStop = timetable.bus.stops.get(bounds.last?.stopId);
    const firstTime = eventTime(bounds.first);
    const lastTime = eventTime(bounds.last);
    return {
      tripId: segmentTripId,
      route: segmentRoute?.shortName || segmentRoute?.longName,
      origin: firstStop?.name,
      destination: segmentTrip.destination || lastStop?.name,
      departsAt: Number.isFinite(firstTime) ? new Date(firstTime).toISOString() : undefined,
      arrivesAt: Number.isFinite(lastTime) ? new Date(lastTime).toISOString() : undefined,
    };
  };
  const formationSegments = [previousFormation, nextFormation].filter(Boolean).map(formationSegment);

  // Vehicle positions can arrive without a matching realtime trip update.
  // Fall back to the official static block sequence so formed-by/forming still
  // works for buses whose operator only publishes positions — but ONLY when
  // the current trip has no block_id at all, and even then require live
  // vehicle-identity confirmation. Matching by "same route + service, stop
  // continues within the gap" alone is not evidence of the same physical bus
  // — plenty of frequent routes have a different bus arrive at the same stop
  // shortly after another leaves.
  if (currentTrip && !currentTrip.blockId && scheduledStopTimes.length && ownVehicleIdentity) {
    const ownFirst = scheduledStopTimes[0];
    const ownLast = scheduledStopTimes.at(-1);
    const ownStart = gtfsTimeToDate(serviceDate, ownFirst.departureTime || ownFirst.arrivalTime)?.getTime();
    const ownEnd = gtfsTimeToDate(serviceDate, ownLast.arrivalTime || ownLast.departureTime)?.getTime();
    let staticPrevious;
    let staticNext;
    let staticPreviousGap = Number.POSITIVE_INFINITY;
    let staticNextGap = Number.POSITIVE_INFINITY;
    for (const [candidateTripId, candidateTrip] of timetable.bus.trips) {
      if (
        candidateTripId === tripId ||
        candidateTrip.serviceId !== currentTrip.serviceId ||
        candidateTrip.routeId !== currentTrip.routeId ||
        vehicleIdentityByTripId.get(candidateTripId) !== ownVehicleIdentity
      ) continue;
      const candidateStops = readIndexedBusStopTimes(candidateTripId);
      const first = candidateStops[0];
      const last = candidateStops.at(-1);
      if (!first || !last) continue;
      const start = gtfsTimeToDate(serviceDate, first.departureTime || first.arrivalTime)?.getTime();
      const end = gtfsTimeToDate(serviceDate, last.arrivalTime || last.departureTime)?.getTime();
      if (last.stopId === ownFirst.stopId && Number.isFinite(end) && Number.isFinite(ownStart)) {
        const gap = ownStart - end;
        if (gap >= 0 && gap <= 90 * 60_000 && gap < staticPreviousGap) {
          staticPrevious = { tripId: candidateTripId, trip: candidateTrip, first, last, start, end };
          staticPreviousGap = gap;
        }
      }
      if (first.stopId === ownLast.stopId && Number.isFinite(start) && Number.isFinite(ownEnd)) {
        const gap = start - ownEnd;
        if (gap >= 0 && gap <= 90 * 60_000 && gap < staticNextGap) {
          staticNext = { tripId: candidateTripId, trip: candidateTrip, first, last, start, end };
          staticNextGap = gap;
        }
      }
    }
    const staticSegment = (candidate) => {
      const candidateRoute = timetable.bus.routes.get(candidate.trip.routeId);
      return {
        tripId: candidate.tripId,
        route: candidateRoute?.shortName || candidateRoute?.longName,
        origin: timetable.bus.stops.get(candidate.first.stopId)?.name,
        destination: candidate.trip.destination || timetable.bus.stops.get(candidate.last.stopId)?.name,
        departsAt: Number.isFinite(candidate.start) ? new Date(candidate.start).toISOString() : undefined,
        arrivesAt: Number.isFinite(candidate.end) ? new Date(candidate.end).toISOString() : undefined,
      };
    };
    if (!previousFormation && staticPrevious) formationSegments.unshift(staticSegment(staticPrevious));
    if (!nextFormation && staticNext) formationSegments.push(staticSegment(staticNext));
  }

  return {
    tripId: requestedTripId,
    scheduledTripId: tripId,
    route: route?.shortName || update?.trip?.routeId,
    destination: trip?.destination,
    scheduleRelationship: toNumber(update?.trip?.scheduleRelationship),
    stops: stops.slice(0, 120),
    formationSegments,
    generatedAt: new Date().toISOString(),
    realtimeFeedAt: toNumber(feed?.header?.timestamp)
      ? new Date(toNumber(feed.header.timestamp) * 1000).toISOString()
      : undefined,
    scheduleUpdatedAt: timetable.scheduleUpdatedAt,
    source: update
      ? "Transport Victoria GTFS Schedule + GTFS-Realtime"
      : "Transport Victoria GTFS Schedule",
  };
}
