import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { isPtvV3Configured, ptvV3Fetch } from "../_lib/ptv-v3.js";

const PTV_BASE_URL =
  "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/tram";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_GTFS_PATH = path.join(REPO_ROOT, ".local-host", "gtfs.zip");

// GTFS-Realtime VehiclePosition's TripDescriptor never carries a headsign (it's
// a static-schedule-only field) — every "trip.tripHeadsign" read below is
// always undefined in the raw feed. The only way to know a tram's real
// destination is to look up its trip_id against the static trips.txt.
let tramHeadsignIndexPromise;

// The realtime feed's trip_id carries a different "service pattern" segment
// than the matching static-schedule trip (e.g. realtime "03-86--7-T5-142606618"
// vs static "03-86--5-T5-142606618" — only that one digit differs), so an
// exact-match lookup against trips.txt almost never hits. Drop that one
// segment from both sides before comparing so the two agree.
function normaliseScheduleTripKey(tripId) {
  const parts = String(tripId ?? "").split("-");
  if (parts.length < 6) return tripId;
  return [...parts.slice(0, 3), ...parts.slice(4)].join("-");
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

async function loadTramHeadsignIndex() {
  if (!tramHeadsignIndexPromise) {
    tramHeadsignIndexPromise = Promise.resolve().then(() => {
      const gtfsPath = process.env.GTFS_SCHEDULE_PATH || DEFAULT_GTFS_PATH;
      const index = new Map();
      if (!fs.existsSync(gtfsPath)) return index;

      const outerZip = new AdmZip(gtfsPath);
      const nestedEntry = outerZip.getEntry("3/google_transit.zip");
      if (!nestedEntry) return index;
      const nestedZip = new AdmZip(nestedEntry.getData());
      const tripsEntry = nestedZip.getEntry("trips.txt");
      if (!tripsEntry) return index;

      const text = tripsEntry.getData().toString("utf8");
      const lines = text.split("\n");
      const headers = parseCsvLine(lines[0].replace(/^﻿/, "").replace(/\r$/, ""));
      const tripIdIndex = headers.indexOf("trip_id");
      const headsignIndex = headers.indexOf("trip_headsign");
      if (tripIdIndex === -1 || headsignIndex === -1) return index;

      for (let i = 1; i < lines.length; i += 1) {
        const rawLine = lines[i].replace(/\r$/, "");
        if (!rawLine) continue;
        const values = parseCsvLine(rawLine);
        const headsign = values[headsignIndex]?.trim();
        if (headsign) index.set(normaliseScheduleTripKey(values[tripIdIndex]), headsign);
      }
      return index;
    }).catch((error) => {
      tramHeadsignIndexPromise = undefined;
      throw error;
    });
  }
  return tramHeadsignIndexPromise;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return undefined;
}

function normaliseRoute(routeId, fallback = "Tram") {
  if (typeof routeId !== "string") {
    return fallback;
  }

  const trimmed = routeId.trim();
  if (!trimmed) {
    return fallback;
  }

  const ptvRouteIdMatch = trimmed.match(/^\d{2}-([A-Z]?\d{1,4}[A-Z]?)(?:-|$)/i);
  if (ptvRouteIdMatch?.[1]) {
    return ptvRouteIdMatch[1].toUpperCase();
  }

  const routeMatch = trimmed.match(/\b([A-Z]?\d{1,4}[A-Z]?)\b/i);
  if (routeMatch) {
    return routeMatch[1].toUpperCase();
  }

  return fallback;
}

function normaliseLabel(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    return trimmed;
  }

  return "Tram";
}

function normaliseDestination(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (/^aus:vic:vic-02-[A-Z0-9-]+:?$/i.test(trimmed) || /^vic-02-[A-Z0-9-]+:?$/i.test(trimmed)) {
      continue;
    }
    return trimmed;
  }

  return undefined;
}

function buildPtvLiveTrams(feed, headsignIndex) {
  return (feed.entity ?? [])
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;
      if (!vehicle || !position) return null;

      const latitude = position.latitude;
      const longitude = position.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return null;

      // A trip ID identifies one run, not its route. Keep both values so the
      // client can load the exact, dated stopping pattern for this vehicle.
      const tripId = vehicle.trip?.tripId;
      const route = normaliseRoute(vehicle.trip?.routeId || tripId || entity.id);
      const timestamp = toNumber(vehicle.timestamp);
      const label = normaliseLabel(vehicle.vehicle?.label, vehicle.vehicle?.licensePlate, route);
      const fleetNumber = typeof vehicle.vehicle?.id === "string" && /^\d+$/.test(vehicle.vehicle.id.trim())
        ? vehicle.vehicle.id.trim()
        : undefined;
      const destination = normaliseDestination(
        headsignIndex?.get(normaliseScheduleTripKey(tripId)),
        vehicle.trip?.tripHeadsign,
        vehicle.trip?.headsign,
        vehicle.trip?.tripShortName,
      );

      return {
        id: entity.id || vehicle.vehicle?.id || `${route}-${latitude}-${longitude}`,
        tripId: typeof tripId === "string" && tripId.trim() ? tripId.trim() : undefined,
        label,
        fleetNumber,
        lat: latitude,
        lng: longitude,
        route,
        destination,
        status: "live",
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
        heading: typeof position.bearing === "number" ? position.bearing : undefined,
        operator: "Yarra Trams",
      };
    })
    .filter(Boolean);
}

// Trains already fall back to PTV's separate Timetable v3 API when the
// primary GTFS-Realtime feed fails (see fetchPtvV3LiveTrains in
// live-trains.js) — trams had no equivalent at all. route_types: 1 is
// PTV's own tram mode code (confirmed live: 24 real routes returned).
// This is real redundancy for a narrower failure where only one of the two
// sources is down; it does not help when both are down at once (confirmed
// live during this same outage: v3 also returned zero vehicle_position
// entries across every sampled route — a shared upstream data problem, not
// something either fallback can route around).
let ptvV3TramCache = { loadedAt: 0, trams: [] };

function buildPtvV3LiveTrams(data) {
  return (data?.runs ?? [])
    .map((run) => {
      const position = run.vehicle_position;
      const latitude = Number(position?.latitude);
      const longitude = Number(position?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      if (latitude === 0 || longitude === 0) return null;

      const route = normaliseRoute(run.route_id || run.route_number, "Tram");
      const destination = normaliseDestination(run.destination_name);
      const descriptor = run.vehicle_descriptor || {};
      const fleetNumber = typeof descriptor.id === "string" && /^\d+$/.test(descriptor.id.trim())
        ? descriptor.id.trim()
        : undefined;

      return {
        id: run.run_id ? String(run.run_id) : `${route}-${latitude}-${longitude}`,
        tripId: run.run_id ? String(run.run_id) : undefined,
        label: normaliseLabel(descriptor.id, descriptor.description, route),
        fleetNumber,
        lat: latitude,
        lng: longitude,
        route,
        destination,
        status: "live",
        timestamp: new Date().toISOString(),
        heading: Number.isFinite(Number(position.bearing)) ? Number(position.bearing) : undefined,
        operator: "Yarra Trams",
        source: "PTV Timetable v3",
      };
    })
    .filter(Boolean);
}

async function fetchPtvV3LiveTrams() {
  if (Date.now() - ptvV3TramCache.loadedAt < 8_000) return ptvV3TramCache.trams;
  const routeData = await ptvV3Fetch("/v3/routes", { route_types: 1 });
  const routes = (routeData?.routes ?? []).filter((route) => route.route_id);
  const results = await Promise.allSettled(
    routes.map((route) =>
      ptvV3Fetch(`/v3/runs/route/${route.route_id}`, { expand: "VehiclePosition" }).then(buildPtvV3LiveTrams),
    ),
  );
  const trams = results.filter((result) => result.status === "fulfilled").flatMap((result) => result.value);
  ptvV3TramCache = { loadedAt: Date.now(), trams };
  return trams;
}

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

export default async function handler(req, res) {
  const ptvSubscriptionKey =
    process.env.PTV_SUBSCRIPTION_KEY ||
    process.env.PTV_subscription_key ||
    process.env.OCP_APIM_SUBSCRIPTION_KEY ||
    process.env.PTV_API_KEY;

  if (!ptvSubscriptionKey) {
    res.status(503).json({
      error: "Live tram positions need a Transport Victoria KeyID. Static tram routes remain available from GTFS.",
      code: "PTV_KEY_REQUIRED",
      trams: [],
    });
    return;
  }

  const bounds = readBoundsFilter(req.query);
  let primaryError;

  try {
    const response = await fetch(`${PTV_BASE_URL}/vehicle-positions`, {
      headers: {
        KeyID: ptvSubscriptionKey,
        "Ocp-Apim-Subscription-Key": ptvSubscriptionKey,
      },
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      primaryError = `PTV request failed (${response.status}): ${details.slice(0, 200)}`;
    } else {
      const buffer = await response.arrayBuffer();
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
      const headsignIndex = await loadTramHeadsignIndex().catch(() => undefined);
      const trams = buildPtvLiveTrams(feed, headsignIndex).filter((tram) => withinBounds(tram, bounds));
      res.status(200).json({ trams });
      return;
    }
  } catch (error) {
    primaryError = error instanceof Error ? error.message : "Failed to load live trams";
  }

  // Primary feed failed — try the v3 fallback before giving up.
  if (isPtvV3Configured()) {
    try {
      const trams = (await fetchPtvV3LiveTrams()).filter((tram) => withinBounds(tram, bounds));
      if (trams.length > 0) {
        res.status(200).json({ trams, source: "PTV Timetable v3" });
        return;
      }
    } catch (error) {
      console.warn("[live-trams] v3 fallback failed:", error instanceof Error ? error.message : error);
    }
  }

  // Both real sources came back empty — this is a genuine PTV-side outage,
  // not something either fallback can route around. Report it plainly
  // (with the real error text) rather than a bare 500, so callers — and,
  // via metro-notify/alerts.js, the Today's Alerts feed — can surface it as
  // an actual "tram tracking is down" notice instead of trams just quietly
  // vanishing from the map.
  res.status(503).json({
    error: "Live tram tracking is currently unavailable — PTV's own tram data feed is down.",
    code: "TRAM_FEED_DOWN",
    details: primaryError,
    trams: [],
  });
}

// PTV's real feed has been observed flapping down/up within a single
// ~60s poll cycle — a real, momentary blip, not a genuine outage — which
// previously fired a full "Suspended"/"Back Online" push pair every time,
// spamming the phone roughly hourly. Require the RAW status to agree
// across several consecutive checks before the CONFIRMED status (what
// callers actually see) flips either way, so a one-cycle blip never
// reaches a push notification while a real, sustained outage still gets
// reported within a few minutes.
const TRAM_FEED_DEBOUNCE_THRESHOLD = 3;
let tramFeedConfirmedDown = false;
let tramFeedConsecutiveDown = 0;
let tramFeedConsecutiveUp = 0;

// Used by metro-notify/alerts.js to decide whether to surface a real "tram
// tracking is down" alert — reuses the exact same check this handler does,
// so the alert only ever reflects a genuine, currently-confirmed outage.
export async function checkTramFeedStatus() {
  const rawStatus = await checkTramFeedStatusRaw();
  if (rawStatus.down) {
    tramFeedConsecutiveDown += 1;
    tramFeedConsecutiveUp = 0;
    if (tramFeedConsecutiveDown >= TRAM_FEED_DEBOUNCE_THRESHOLD) tramFeedConfirmedDown = true;
  } else {
    tramFeedConsecutiveUp += 1;
    tramFeedConsecutiveDown = 0;
    if (tramFeedConsecutiveUp >= TRAM_FEED_DEBOUNCE_THRESHOLD) tramFeedConfirmedDown = false;
  }
  return { down: tramFeedConfirmedDown };
}

async function checkTramFeedStatusRaw() {
  const ptvSubscriptionKey =
    process.env.PTV_SUBSCRIPTION_KEY ||
    process.env.PTV_subscription_key ||
    process.env.OCP_APIM_SUBSCRIPTION_KEY ||
    process.env.PTV_API_KEY;
  if (!ptvSubscriptionKey) return { down: false };

  try {
    const response = await fetch(`${PTV_BASE_URL}/vehicle-positions`, {
      headers: { KeyID: ptvSubscriptionKey, "Ocp-Apim-Subscription-Key": ptvSubscriptionKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
      if ((feed.entity ?? []).length > 0) return { down: false };
    }
  } catch {
    // fall through to the v3 check
  }

  if (isPtvV3Configured()) {
    try {
      const trams = await fetchPtvV3LiveTrams();
      if (trams.length > 0) return { down: false };
    } catch {
      // both sources unavailable
    }
  }

  return { down: true };
}
