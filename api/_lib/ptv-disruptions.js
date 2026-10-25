import { isPtvV3Configured, ptvV3Fetch } from "./ptv-v3.js";

// Metro's own healthboard feed only ever covers metro trains, so anything
// V/Line, tram, bus, ferry, or network-wide (e.g. a Gippsland Line
// suspension) never reached the app at all. PTV's official Timetable v3
// disruptions endpoint covers every mode from one authoritative source —
// metro_train is deliberately excluded here since Metro's own feed already
// covers that mode, and pulling it again would just duplicate every alert.
const MODE_LABELS = {
  general: "Network",
  metro_tram: "Tram",
  metro_bus: "Bus",
  regional_train: "V/Line",
  regional_coach: "V/Line Coach",
  regional_bus: "Regional Bus",
  night_bus: "Night Bus",
  ferry: "Ferry",
  skybus: "SkyBus",
  interstate_train: "Interstate Train",
};

// A route-name line (e.g. "Altona - Mordialloc (SMARTBUS Service)") often
// mentions a station or suburb that collides with a train line's grouping
// keywords, which would otherwise misfile a plain bus/tram disruption under
// an unrelated train line. Carrying the true PTV category through as `mode`
// lets the frontend group these correctly regardless of what text is in it.
const MODE_GROUPS = {
  metro_tram: "tram",
  metro_bus: "bus",
  regional_bus: "bus",
  night_bus: "bus",
  // PTV's "interstate_train" disruption mode is the Sydney-Melbourne XPT —
  // the only interstate rail service it covers — so it gets its own
  // structured group instead of falling through to a text-matched guess.
  interstate_train: "xpt",
};

// V/Line's own GTFS route_short_name already groups every regional line into
// one of these corridors (this is literally V/Line's own public naming) —
// the one exception is the Traralgon/Bairnsdale corridor, whose corridor id
// here is renamed to the commonly-recognised "Gippsland" (as PTV's own
// disruption titles and OnBoard both call it), which V/Line's raw GTFS short
// name doesn't use. route_gtfs_id on a disruption's `routes[]` is formatted
// "1-<CODE>"; the map below is keyed by just the <CODE> part.
const VLINE_CORRIDOR_BY_ROUTE_CODE = {
  ABY: "seymour", // Albury - Melbourne via Seymour
  ART: "ballarat", // Ararat - Melbourne via Ballarat
  BAT: "ballarat", // Ballarat - Melbourne via Melton
  BDE: "gippsland", // Bairnsdale - Melbourne via Traralgon & Sale
  BGO: "bendigo", // Bendigo - Melbourne via Sunbury
  ECH: "bendigo", // Echuca/Moama - Melbourne via Bendigo or Heathcote
  GEL: "geelong", // Geelong - Melbourne
  MBY: "ballarat", // Maryborough - Melbourne via Ballarat
  SER: "seymour", // Seymour - Melbourne via Broadmeadows
  SNH: "seymour", // Shepparton - Melbourne via Seymour
  SWL: "bendigo", // Swan Hill - Melbourne via Bendigo
  TRN: "gippsland", // Traralgon - Melbourne via Pakenham, Moe & Morwell
  WBL: "geelong", // Warrnambool - Melbourne via Geelong & Colac
};

// Tier 2 (affected stations) and tier 3 (text fallback) both boil down to
// "does this station/suburb name belong to a known corridor" — same list,
// checked against `stops[]` first (structured, when PTV populates it) and
// only against the free-text title/description as a last resort.
const VLINE_CORRIDOR_KEYWORDS = {
  gippsland: ["traralgon", "morwell", "sale", "bairnsdale", "moe", "warragul", "drouin", "garfield", "bunyip", "berwick", "pakenham", "east pakenham"],
  geelong: ["geelong", "waurn ponds", "wyndham vale", "south geelong", "marshall", "corio", "lara", "north shore", "colac", "warrnambool", "little river"],
  ballarat: ["ballarat", "wendouree", "ararat", "melton", "bacchus marsh", "maryborough", "beaufort", "creswick"],
  bendigo: ["bendigo", "epsom", "eaglehawk", "echuca", "kyneton", "castlemaine", "swan hill", "heathcote", "huntly", "malmsbury", "woodend"],
  seymour: ["seymour", "shepparton", "albury", "wangaratta", "benalla", "euroa", "violet town", "wodonga", "broadmeadows"],
};

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Tier 1: structured GTFS route data — the routes a disruption is officially
// tagged against on PTV's own system. Most reliable, tried first.
function corridorsFromRoutes(disruption) {
  const codes = (disruption?.routes ?? [])
    .map((route) => String(route?.route_gtfs_id ?? "").match(/^\d+-([A-Z0-9]+)$/)?.[1])
    .filter(Boolean);
  return [...new Set(codes.map((code) => VLINE_CORRIDOR_BY_ROUTE_CODE[code]).filter(Boolean))];
}

// Tier 2: affected stations, when PTV populates `stops[]` on the disruption.
function corridorsFromStops(disruption) {
  const stopNames = (disruption?.stops ?? []).map((stop) => String(stop?.stop_name ?? "").toLowerCase());
  if (!stopNames.length) return [];
  const matched = new Set();
  for (const [corridor, keywords] of Object.entries(VLINE_CORRIDOR_KEYWORDS)) {
    if (keywords.some((keyword) => stopNames.some((name) => name.includes(keyword)))) {
      matched.add(corridor);
    }
  }
  return [...matched];
}

// Tier 3: last resort — keyword matching against the disruption's own text.
function corridorsFromText(text) {
  const searchable = text.toLowerCase();
  const matched = new Set();
  for (const [corridor, keywords] of Object.entries(VLINE_CORRIDOR_KEYWORDS)) {
    if (keywords.some((keyword) => new RegExp(`\\b${keyword}\\b`, "i").test(searchable))) {
      matched.add(corridor);
    }
  }
  return [...matched];
}

function resolveVlineCorridors(disruption, searchableText) {
  const fromRoutes = corridorsFromRoutes(disruption);
  if (fromRoutes.length) return fromRoutes;

  const fromStops = corridorsFromStops(disruption);
  if (fromStops.length) return fromStops;

  return corridorsFromText(searchableText);
}

function normalisePtvDisruption(disruption, modeLabel, modeKey) {
  const summary = stripHtml(disruption?.description || disruption?.title);
  if (!summary) return null;

  const routeNames = [...new Set((disruption?.routes ?? []).map((route) => route?.route_name).filter(Boolean))];
  const title = stripHtml(disruption?.disruption_type) || modeLabel;

  const alert = {
    id: `ptv-disruption-${disruption?.disruption_id}`,
    title,
    summary,
    lines: routeNames.length ? routeNames : [modeLabel],
    status: title.toLowerCase(),
    updatedAt: disruption?.last_updated || disruption?.published_on || undefined,
    url: typeof disruption?.url === "string" && disruption.url.trim() ? disruption.url.trim() : undefined,
    mode: MODE_GROUPS[modeKey],
  };

  // V/Line trains always get a corridor lookup. V/Line coaches only take the
  // corridor if their own routes/stations resolve to one of the five (e.g. a
  // genuine rail-replacement coach for a specific line) — most V/Line coach
  // disruptions are standalone long-distance coach routes (Cowes, Adelaide,
  // Apollo Bay) that aren't any of the five train corridors at all, and
  // belong in the general Buses group instead.
  if (modeKey === "regional_train" || modeKey === "regional_coach") {
    const corridors = resolveVlineCorridors(disruption, `${title} ${summary}`);
    if (corridors.length) {
      alert.mode = "vline";
      alert.corridors = corridors;
    } else if (modeKey === "regional_coach") {
      alert.mode = "bus";
    } else {
      alert.mode = "vline";
      alert.corridors = [];
    }
  }

  return alert;
}

export async function fetchNonMetroTrainDisruptions() {
  if (!isPtvV3Configured()) return [];

  const data = await ptvV3Fetch("/v3/disruptions");
  const alerts = [];

  for (const [mode, label] of Object.entries(MODE_LABELS)) {
    const list = data?.disruptions?.[mode];
    if (!Array.isArray(list)) continue;

    for (const disruption of list) {
      if (disruption?.disruption_status && disruption.disruption_status !== "Current") continue;
      const alert = normalisePtvDisruption(disruption, label, mode);
      if (alert) alerts.push(alert);
    }
  }

  return alerts;
}
