export type InterchangeType = "major_interchange" | "local_interchange" | "bus_interchange";

export type TransitInterchange = {
  name: string;
  type: InterchangeType;
  trainLines: string[];
  tramRoutes: string[];
  busRoutes: string[];
  coachLinks?: string[];
  notes?: string;
};

export type TramRouteStyle = {
  background: string;
  color: string;
  border?: string;
};

export const TRAM_ROUTE_STYLES: Record<string, TramRouteStyle> = {
  "1": { background: "#b7c933", color: "#10210f" },
  "3": { background: "#9bd3f5", color: "#0f172a" },
  "3a": { background: "#9bd3f5", color: "#0f172a" },
  "5": { background: "#e21f35", color: "#ffffff" },
  "6": { background: "#005a86", color: "#ffffff" },
  "11": { background: "#66c3ad", color: "#0f172a" },
  "12": { background: "#00a3ad", color: "#ffffff" },
  "16": { background: "#f2c84b", color: "#111827" },
  "19": { background: "#8b1d57", color: "#ffffff" },
  "30": { background: "#67529a", color: "#ffffff" },
  "35": { background: "#7b4b3a", color: "#ffffff" },
  "48": { background: "#3f3f46", color: "#ffffff" },
  "57": { background: "#13b8c7", color: "#0f172a" },
  "58": { background: "#8f959b", color: "#ffffff" },
  "59": { background: "#008f5a", color: "#ffffff" },
  "64": { background: "#00a884", color: "#ffffff" },
  "67": { background: "#8b5e3c", color: "#fff7ed", border: "rgba(231,211,198,0.74)" },
  "70": { background: "#e889b3", color: "#111827" },
  "72": { background: "#8fb9a5", color: "#10210f" },
  "75": { background: "#00a6d6", color: "#ffffff" },
  "78": { background: "#6f65a8", color: "#ffffff" },
  "82": { background: "#c9d744", color: "#111827" },
  "86": { background: "#f5b21a", color: "#111827" },
  "96": { background: "#c01783", color: "#ffffff" },
  "109": { background: "#f36f21", color: "#ffffff" },
};

export function getTramRouteStyle(route: string): TramRouteStyle {
  return TRAM_ROUTE_STYLES[route.trim().toLowerCase()] ?? { background: "#0f172a", color: "#f8fafc" };
}

export const INTERCHANGE_DATABASE: TransitInterchange[] = [
  {
    name: "Box Hill",
    type: "major_interchange",
    trainLines: ["Belgrave", "Lilydale"],
    tramRoutes: ["109"],
    busRoutes: ["201", "270", "271", "279", "281", "284", "293", "302", "612", "732", "733", "735", "765", "766", "767", "903 SmartBus"],
    notes: "Major eastern interchange with heavy bus, rail and tram connections.",
  },
  {
    name: "Dandenong",
    type: "major_interchange",
    trainLines: ["Cranbourne", "Pakenham", "Gippsland V/Line"],
    tramRoutes: [],
    busRoutes: ["800", "811", "812", "813", "814", "828", "857", "861", "862", "901 SmartBus", "902 SmartBus"],
  },
  {
    name: "Sunshine",
    type: "major_interchange",
    trainLines: ["Sunbury", "Ballarat", "Bendigo", "Geelong"],
    tramRoutes: [],
    busRoutes: ["216", "220", "408", "410", "903 SmartBus"],
    notes: "Western rail hub and future airport rail interchange.",
  },
  {
    name: "Footscray",
    type: "major_interchange",
    trainLines: ["Werribee", "Williamstown", "Sunbury", "V/Line"],
    tramRoutes: [],
    busRoutes: ["216", "219", "220", "223", "406", "409", "411", "412", "414", "903 SmartBus"],
  },
  {
    name: "Broadmeadows",
    type: "major_interchange",
    trainLines: ["Craigieburn"],
    tramRoutes: [],
    busRoutes: ["477", "484", "485", "529", "531", "532", "540", "541", "901 SmartBus"],
  },
  {
    name: "Frankston",
    type: "major_interchange",
    trainLines: ["Frankston", "Stony Point"],
    tramRoutes: [],
    busRoutes: ["770", "771", "772", "773", "774", "775", "776", "778", "780", "781", "782", "783", "784", "785", "788", "789"],
  },
  {
    name: "Ringwood",
    type: "major_interchange",
    trainLines: ["Belgrave", "Lilydale"],
    tramRoutes: [],
    busRoutes: ["271", "364", "366", "670", "671", "672", "679", "737", "742", "901 SmartBus"],
  },
  {
    name: "Caulfield",
    type: "major_interchange",
    trainLines: ["Cranbourne", "Pakenham", "Frankston"],
    tramRoutes: ["3", "3a", "64"],
    busRoutes: ["624", "900 SmartBus"],
    notes: "Change here for: City Loop via Frankston · Metro Tunnel to Sunbury, Pakenham & Cranbourne · V/Line to Bairnsdale · Trams 3/3a & 64",
  },
  {
    name: "South Yarra",
    type: "major_interchange",
    trainLines: ["Frankston", "Sandringham"],
    tramRoutes: ["3", "5", "6", "16", "58", "72", "78"],
    busRoutes: [],
  },
  {
    name: "Flinders Street",
    type: "major_interchange",
    trainLines: ["City Loop", "Metro", "V/Line"],
    tramRoutes: ["1", "3", "3a", "5", "6", "16", "19", "35", "48", "57", "59", "64", "67", "70", "72", "75", "86", "96", "109"],
    busRoutes: [],
    notes: "Major CBD train and tram interchange.",
  },
  {
    name: "Southern Cross",
    type: "major_interchange",
    trainLines: ["City Loop", "Metro", "V/Line", "Regional coach"],
    tramRoutes: ["11", "12", "30", "35", "48", "75", "86", "96"],
    busRoutes: [],
    notes: "Major CBD rail, coach and tram interchange.",
  },
  {
    name: "Flagstaff",
    type: "major_interchange",
    trainLines: ["City Loop"],
    tramRoutes: ["30", "35", "58"],
    busRoutes: [],
  },
  {
    name: "Melbourne Central",
    type: "major_interchange",
    trainLines: ["City Loop"],
    tramRoutes: ["1", "3", "3a", "5", "6", "16", "19", "30", "57", "58", "59", "64", "67", "72"],
    busRoutes: [],
  },
  {
    name: "Parliament",
    type: "major_interchange",
    trainLines: ["City Loop"],
    tramRoutes: ["11", "12", "30", "35", "48", "86", "96", "109"],
    busRoutes: [],
  },
  {
    name: "Richmond",
    type: "major_interchange",
    trainLines: ["Belgrave", "Lilydale", "Glen Waverley", "Alamein", "Frankston", "Cranbourne", "Pakenham", "Sandringham"],
    tramRoutes: ["70", "75", "78"],
    busRoutes: [],
  },
  {
    name: "Jolimont",
    type: "local_interchange",
    trainLines: ["Mernda", "Hurstbridge"],
    tramRoutes: ["75"],
    busRoutes: [],
  },
  {
    name: "East Richmond",
    type: "local_interchange",
    trainLines: ["Belgrave", "Lilydale", "Glen Waverley", "Alamein"],
    tramRoutes: ["78"],
    busRoutes: [],
  },
  {
    name: "Burnley",
    type: "local_interchange",
    trainLines: ["Belgrave", "Lilydale", "Glen Waverley", "Alamein"],
    tramRoutes: ["70"],
    busRoutes: [],
  },
  {
    name: "Hawthorn",
    type: "local_interchange",
    trainLines: ["Belgrave", "Lilydale"],
    tramRoutes: ["75"],
    busRoutes: [],
  },
  {
    name: "Glenferrie",
    type: "local_interchange",
    trainLines: ["Belgrave", "Lilydale"],
    tramRoutes: ["16"],
    busRoutes: [],
  },
  {
    name: "Camberwell",
    type: "local_interchange",
    trainLines: ["Belgrave", "Lilydale", "Alamein"],
    tramRoutes: ["72"],
    busRoutes: [],
  },
  {
    name: "Riversdale",
    type: "local_interchange",
    trainLines: ["Alamein"],
    tramRoutes: ["70"],
    busRoutes: [],
  },
  {
    name: "Hartwell",
    type: "local_interchange",
    trainLines: ["Alamein"],
    tramRoutes: ["75"],
    busRoutes: [],
  },
  {
    name: "Toorak",
    type: "local_interchange",
    trainLines: ["Frankston"],
    tramRoutes: ["58"],
    busRoutes: [],
  },
  {
    name: "Armadale",
    type: "local_interchange",
    trainLines: ["Frankston"],
    tramRoutes: ["6"],
    busRoutes: [],
  },
  {
    name: "Windsor",
    type: "local_interchange",
    trainLines: ["Sandringham"],
    tramRoutes: ["5"],
    busRoutes: [],
  },
  {
    name: "Balaclava",
    type: "local_interchange",
    trainLines: ["Sandringham"],
    tramRoutes: ["3", "3a", "16", "78"],
    busRoutes: [],
  },
  {
    name: "Oakleigh",
    type: "major_interchange",
    trainLines: ["Cranbourne", "Pakenham"],
    tramRoutes: [],
    busRoutes: ["625", "693", "700", "701", "703", "733", "800", "802", "804", "862", "903 SmartBus"],
  },
  {
    name: "Doncaster Park & Ride",
    type: "bus_interchange",
    trainLines: [],
    tramRoutes: [],
    busRoutes: ["200", "207", "281", "284", "901 SmartBus", "907", "908"],
  },
  {
    name: "Ormond",
    type: "local_interchange",
    trainLines: ["Frankston"],
    tramRoutes: [],
    busRoutes: ["625", "630"],
    notes: "Change here for: Bus 625 to Elsternwick or Chadstone · Bus 630 to Elwood or Monash University · Frankston Line services via the City Loop",
  },
  {
    name: "McKinnon",
    type: "local_interchange",
    trainLines: ["Frankston"],
    tramRoutes: [],
    busRoutes: ["626"],
    notes: "Change here for: Route 626 buses to Chadstone or Middle Brighton · Frankston Line services via the City Loop",
  },
  {
    name: "Gardenvale",
    type: "local_interchange",
    trainLines: ["Sandringham"],
    tramRoutes: [],
    busRoutes: ["630"],
    notes: "Change here for: Bus 630 · Sandringham Line services to Flinders Street · Cross-city services to Werribee & Williamstown",
  },
  {
    name: "Elsternwick",
    type: "local_interchange",
    trainLines: ["Sandringham"],
    tramRoutes: ["67"],
    busRoutes: ["246", "603", "625"],
  },
  {
    name: "North Brighton",
    type: "local_interchange",
    trainLines: ["Sandringham"],
    tramRoutes: [],
    busRoutes: ["626", "703", "823"],
    notes: "Change here for: Bus 626, 703 & 823 · Sandringham Line services to Flinders Street · Cross-city services to Werribee, Williamstown & Laverton",
  },
  {
    name: "Glen Huntly",
    type: "local_interchange",
    trainLines: ["Frankston"],
    tramRoutes: ["67"],
    busRoutes: [],
    notes: "Change here for: Route 67 trams to Melbourne University / Carnegie · Frankston Line services via the City Loop",
  },
  {
    name: "Carnegie",
    type: "local_interchange",
    trainLines: ["Cranbourne", "Pakenham"],
    tramRoutes: ["67"],
    busRoutes: ["624", "626", "900 SmartBus"],
  },
  {
    name: "Huntingdale",
    type: "local_interchange",
    trainLines: ["Cranbourne", "Pakenham"],
    tramRoutes: [],
    busRoutes: ["630"],
  },
  {
    name: "Moorabbin",
    type: "local_interchange",
    trainLines: ["Frankston"],
    tramRoutes: [],
    busRoutes: ["708", "811", "812", "825"],
  },
  {
    name: "Malvern",
    type: "local_interchange",
    // Real fact, not Glen Waverley (a genuinely different corridor Malvern
    // isn't on at all) — Malvern sits on the Frankston line, which runs via
    // the City Loop toward the CBD and via the Metro Tunnel toward Sunbury,
    // Cranbourne and East Pakenham on the other side of the city.
    trainLines: ["Frankston", "Sunbury", "Cranbourne", "East Pakenham"],
    tramRoutes: ["16"],
    busRoutes: [],
    notes: "Change here for: Frankston Line City Loop services · Metro Tunnel services to Sunbury, Cranbourne & East Pakenham · Tram 16",
  },
];

function normaliseStationName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getStationInterchange(stationName: string) {
  const key = normaliseStationName(stationName);
  return INTERCHANGE_DATABASE.find((interchange) => normaliseStationName(interchange.name) === key) ?? null;
}

export function getStationConnectionTags(
  stationName: string,
  options: { includeMajorInterchangeDetails?: boolean; maxTags?: number } = {},
) {
  const interchange = getStationInterchange(stationName);
  if (!interchange) return [];

  if (interchange.type === "major_interchange" && !options.includeMajorInterchangeDetails) {
    return [];
  }

  const tags: string[] = [];
  const maxTags = options.maxTags ?? 4;
  const shouldShowDetailedTrams = options.includeMajorInterchangeDetails || interchange.type !== "major_interchange";
  const displayedTramRoutes = interchange.tramRoutes.filter((route) => !/[a-z]/i.test(route));

  if (shouldShowDetailedTrams || displayedTramRoutes.length <= 3) {
    tags.push(...displayedTramRoutes.map((route) => `Tram ${route}`));
  } else if (displayedTramRoutes.length > 0) {
    tags.push(`Tram x${displayedTramRoutes.length}`);
  }

  const smartBusRoutes = interchange.busRoutes.filter((route) => /smartbus/i.test(route));
  const regularBusRoutes = interchange.busRoutes.filter((route) => !/smartbus/i.test(route));

  tags.push(...regularBusRoutes.map((route) => `Bus ${route}`));

  tags.push(...smartBusRoutes.map((route) => `Bus ${route}`));

  return tags.slice(0, maxTags);
}

// Sunbury, Cranbourne and Pakenham/East Pakenham run through the Metro
// Tunnel rather than the traditional City Loop — a real, current network
// fact (not a guess) that a bare route list glosses over. Every other line
// in this database still loops via Flagstaff/Melbourne Central/
// Parliament/Flinders Street the old way.
const METRO_TUNNEL_LINES = new Set(["Sunbury", "Cranbourne", "Pakenham", "East Pakenham"]);

function joinWithAmpersand(items: string[]) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} & ${items[items.length - 1]}`;
}

// A few entries use these as generic placeholders rather than a real named
// line (e.g. the underground City Loop stations just list "City Loop"
// itself, Footscray lists bare "V/Line" alongside its real named lines) —
// those need their own wording rather than being joined as if they were a
// specific line ("City Loop services via City Loop" reads absurd).
const GENERIC_LINE_LABELS = new Set(["City Loop", "Metro", "V/Line", "Regional coach"]);

export function getStationInterchangeSummary(stationName: string) {
  const interchange = getStationInterchange(stationName);
  if (!interchange) return null;
  // A hand-written summary (real, current corridor names — e.g. "Metro
  // Tunnel to Sunbury" rather than a bare route list) reads better than the
  // generated version below for a station worth explaining in more detail,
  // so it takes over the whole summary rather than being appended to it.
  if (interchange.notes) return interchange.notes;

  // Some entries name a V/Line corridor directly (Dandenong's "Gippsland
  // V/Line") rather than the bare generic label — either way, these are
  // long-distance regional services that never run via the City Loop and
  // need their own clause, not to be joined as if they were a suburban line.
  const vlineEntries = interchange.trainLines.filter((line) => /v\/line/i.test(line));
  const namedCityLoopLines = interchange.trainLines.filter(
    (line) => !METRO_TUNNEL_LINES.has(line) && !GENERIC_LINE_LABELS.has(line) && !/v\/line/i.test(line),
  );
  const tunnelLines = interchange.trainLines.filter((line) => METRO_TUNNEL_LINES.has(line));
  const hasBareCityLoop = interchange.trainLines.includes("City Loop");

  const parts: string[] = [];
  if (namedCityLoopLines.length > 0) {
    parts.push(`City Loop services via ${joinWithAmpersand(namedCityLoopLines)}`);
  } else if (hasBareCityLoop) {
    parts.push("City Loop services");
  }
  if (tunnelLines.length > 0) parts.push(`Metro Tunnel services to ${joinWithAmpersand(tunnelLines)}`);
  if (vlineEntries.length > 0) {
    const corridors = vlineEntries.map((line) => line.replace(/\s*v\/line\s*/i, "").trim()).filter(Boolean);
    parts.push(corridors.length > 0 ? `V/Line services to ${joinWithAmpersand(corridors)}` : "V/Line regional services");
  }
  if (interchange.tramRoutes.length > 0) {
    parts.push(interchange.tramRoutes.length === 1
      ? `Route ${interchange.tramRoutes[0]} tram`
      : `Trams ${joinWithAmpersand(interchange.tramRoutes)}`);
  }
  if (interchange.busRoutes.length > 0) parts.push(`Bus ${joinWithAmpersand(interchange.busRoutes)}`);
  if (interchange.coachLinks?.length) parts.push(`Coach services to ${joinWithAmpersand(interchange.coachLinks)}`);

  return parts.length > 0 ? `Change here for: ${parts.join(" · ")}` : null;
}
