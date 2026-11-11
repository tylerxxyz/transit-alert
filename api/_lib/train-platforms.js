// Metres between two lat/lng points (equirectangular approximation — fine at this scale).
function metresBetween(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(a.lat - b.lat);
  const dLng = toRad(a.lng - b.lng);
  const meanLat = toRad((a.lat + b.lat) / 2);
  const x = dLng * Math.cos(meanLat);
  return 6371000 * Math.sqrt(dLat * dLat + x * x);
}

// A stop the same physical platform, never station names: a station can have many
// platforms. V/Line and Metro sometimes assign the same physical platform two
// different stop_ids (e.g. Footscray's 22240 vs the metro network's 15520 are the
// same platform ~2m apart), so an exact stop_id match misses real, permanent
// platform assignments. Fall back to the nearest metro platform at the same parent
// station, since a platform's location never moves — this is the schedule's usual
// stopping pattern, not a live guess.
const SAME_PLATFORM_RADIUS_METRES = 25;

export function mergeSharedTrainPlatforms(regionalStops, metroStops) {
  const metroByParent = new Map();
  for (const stop of metroStops.values()) {
    if (!stop.platform || !stop.parentStation) continue;
    if (!metroByParent.has(stop.parentStation)) metroByParent.set(stop.parentStation, []);
    metroByParent.get(stop.parentStation).push(stop);
  }

  for (const [id, stop] of regionalStops) {
    if (stop.platform || !stop.parentStation) continue;

    const exact = metroStops.get(id);
    if (exact?.platform && exact.parentStation === stop.parentStation) {
      stop.platform = exact.platform;
      continue;
    }

    const candidates = metroByParent.get(stop.parentStation);
    if (!candidates || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) continue;
    let nearest;
    let nearestDistance = Infinity;
    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) continue;
      const distance = metresBetween(stop, candidate);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = candidate;
      }
    }
    if (nearest && nearestDistance <= SAME_PLATFORM_RADIUS_METRES) {
      stop.platform = nearest.platform;
    }
  }
}

// V/Line's own real GTFS route_id encodes a stable corridor code
// (aus:vic:vic-01-<CODE>:) — the same real codes and corridor groupings
// already used for alert routing in api/_lib/ptv-disruptions.js. Kept as
// its own copy here rather than a cross-import: this table is small,
// stable (V/Line's own published network map), and importing it would pull
// alert-specific code into the timetable path for no real benefit.
const VLINE_CORRIDOR_BY_ROUTE_CODE = {
  ABY: "seymour", ART: "ballarat", BAT: "ballarat", BDE: "gippsland", BGO: "bendigo",
  ECH: "bendigo", GEL: "geelong", MBY: "ballarat", SER: "seymour", SNH: "seymour",
  SWL: "bendigo", TRN: "gippsland", WBL: "geelong",
};

function resolveVlineCorridor(routeId) {
  const code = String(routeId || "").match(/vic-01-([A-Z0-9]+):/)?.[1];
  return code ? VLINE_CORRIDOR_BY_ROUTE_CODE[code] : undefined;
}

// V/Line's own static GTFS almost never carries a platform_code for regional
// stations at all (unlike Metro, which has a separate stop_id per platform)
// — so "live -> scheduled" alone leaves nearly every regional stop showing
// "Platform not published", even at stations whose real platform assignment
// is fixed and well known. This is real, per-station-per-direction data, not
// a formula: a real observed Traralgon-bound (DOWN) service (8429) used
// Platform 2 at most stations but Platform 1 at Yarragon/Trafalgar/Moe and
// back to Platform 2 at Morwell — proof a blanket "DOWN = platform N" rule
// would be wrong even on one line, let alone network-wide. Entries are only
// ever added once independently observed/verified for that specific
// station+direction; an empty direction object just means nobody's
// confirmed data for it yet, not that the stations share one platform.
//
// Southern Cross, Flinders Street, Richmond, Clayton and Dandenong are
// deliberately excluded even on lines where they're observed — they're
// large multi-platform/multi-line stations where one trip's platform is
// not a reliable "usual" answer the way it is at a small regional station.
// Caulfield is the one exception on the Gippsland corridor specifically:
// V/Line's Melbourne-bound (UP) Gippsland services always use Platform 3
// there, a real fixed assignment (not a guess), unlike its DOWN-direction
// platform which does vary by trip along the rest of the corridor.
const VLINE_PLATFORM_FALLBACKS = {
  bendigo: {
    // Echuca branch stations (single platform, serves both directions —
    // Wikipedia / Big Build station fact sheets, Sept 2026).
    UP: { echuca: "1", rochester: "1", elmore: "1", goornong: "1", huntly: "1" },
    DOWN: { echuca: "1", rochester: "1", elmore: "1", goornong: "1", huntly: "1" },
  },
  gippsland: {
    // Real Traralgon-bound (DOWN) service 8429, observed via Google Transit.
    DOWN: {
      pakenham: "2", "nar nar goon": "2", tynong: "2", garfield: "2", bunyip: "2",
      longwarry: "2", drouin: "2", warragul: "2", yarragon: "1", trafalgar: "1",
      moe: "1", morwell: "2", traralgon: "1",
    },
    // Not yet observed — needs a real Traralgon/Bairnsdale -> Melbourne trip.
    UP: {},
  },
};

// Slot for a specific trip/TDN whose real platform is known to differ from
// its line+direction's usual pattern (e.g. a genuine one-off reallocation).
// Keyed by TDN. Empty until a real, confirmed exception is reported.
const VLINE_SERVICE_PLATFORM_OVERRIDES = {};

function normaliseVlineStationName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\brailway station\b|\bstation\b/g, "")
    .replace(/[^a-z ]/g, "")
    .trim();
}

// V/Line trip_headsign is the real, direct signal for which way a regional
// service is running — more robust than trusting direction_id's polarity to
// mean the same thing on every line. "Southern Cross" (and the older
// "Melbourne" headsign some feeds still use) is the only real Melbourne-end
// terminus on the regional network, so anything else is the away direction.
export function resolveVlineDirection(tripDestination) {
  const destination = String(tripDestination || "").toLowerCase();
  if (!destination) return undefined;
  return /southern cross|melbourne/.test(destination) ? "UP" : "DOWN";
}

function resolveVlineStaticPlatform(routeId, stationName, direction) {
  if (!direction) return undefined;
  const corridor = resolveVlineCorridor(routeId);
  if (!corridor) return undefined;
  return VLINE_PLATFORM_FALLBACKS[corridor]?.[direction]?.[normaliseVlineStationName(stationName)];
}

// vlineContext is only ever passed for regional (V/Line) trips — this
// static fallback is specifically for the corridor-wide gap in V/Line's own
// GTFS, and has no bearing on Metro, whose stations already carry a real
// platform_code per platform.
export function resolveTrainPlatformDetails(stop, realtimeStop, stops, livePlatform, vlineContext) {
  if (typeof livePlatform === "string" && livePlatform.trim()) {
    return { platform: livePlatform.trim(), platformSource: "LIVE" };
  }
  const assignedId = realtimeStop?.stopTimeProperties?.assignedStopId || realtimeStop?.stopId;
  if (assignedId && assignedId !== stop?.id) {
    const assigned = stops.get(assignedId);
    if (assigned && stop?.parentStation && assigned.parentStation === stop.parentStation) {
      return { platform: assigned.platform, platformSource: assigned.platform ? "LIVE" : undefined };
    }
    // Do not show an old allocation when a new platform cannot be resolved.
    if (realtimeStop?.stopTimeProperties?.assignedStopId) return {};
  }
  if (stop?.platform) return { platform: stop.platform, platformSource: "SCHEDULED" };

  if (vlineContext) {
    const override = vlineContext.tdn ? VLINE_SERVICE_PLATFORM_OVERRIDES[vlineContext.tdn]?.[normaliseVlineStationName(stop?.name)] : undefined;
    if (override) return { platform: override, platformSource: "service_override" };

    const direction = resolveVlineDirection(vlineContext.tripDestination);
    const staticPlatform = resolveVlineStaticPlatform(vlineContext.routeId, stop?.name, direction);
    if (staticPlatform) return { platform: staticPlatform, platformSource: "static_direction", inferred: true };
  }

  return { platform: undefined, platformSource: undefined };
}

export function resolveTrainPlatform(stop, realtimeStop, stops) {
  return resolveTrainPlatformDetails(stop, realtimeStop, stops).platform;
}
