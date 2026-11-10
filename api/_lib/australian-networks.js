// Official sources checked 30 October 2026. IDs are scoped by feed, since
// agency stop/route IDs are not unique across Australia (or NSW feeds).
const nsw = (id, mode) => ({ id, mode, url: `https://api.transport.nsw.gov.au/${id === "metro" ? "v2" : "v1"}/gtfs/schedule/${id}`, auth: "nsw" });
const qld = (id) => ({ id, url: `https://gtfsrt.api.translink.com.au/GTFS/${id}_GTFS.zip` });
export const NETWORKS = [
  { id: "nsw", name: "Sydney & NSW", center: [-33.8688, 151.2093], zoom: 12,
    attribution: "Transport for NSW · CC BY 4.0", source: "https://opendata.transport.nsw.gov.au/",
    alertsUrl: "https://transportnsw.info/alerts", timezone: "Australia/Sydney",
    schedules: [nsw("sydneytrains"), nsw("metro", "metro"), nsw("buses", "bus"), nsw("buses/ReplacementBus", "bus"), nsw("ferries/sydneyferries", "ferry"), nsw("ferries/MFF", "ferry"), nsw("lightrail/innerwest", "tram"), nsw("lightrail/cbdandsoutheast", "tram"), nsw("lightrail/newcastle", "tram"), nsw("lightrail/parramatta", "tram"), nsw("nswtrains")],
    realtime: [
      ...["sydneytrains", "metro", "buses", "ferries/sydneyferries", "lightrail/innerwest", "lightrail/cbdandsoutheast", "lightrail/newcastle", "lightrail/parramatta", "nswtrains"].map(id => ({ id, auth: "nsw", vehicles: `https://api.transport.nsw.gov.au/${["sydneytrains", "metro", "lightrail/innerwest"].includes(id) ? "v2" : "v1"}/gtfs/vehiclepos/${id}` })),
      ...["sydneytrains", "metro", "buses", "ferries", "lightrail", "nswtrains"].map(id => ({ id, auth: "nsw", alerts: `https://api.transport.nsw.gov.au/v2/gtfs/alerts/${id}` })),
    ] },
  { id: "seq", name: "Brisbane, Gold Coast & Sunshine Coast", center: [-27.4698, 153.0251], zoom: 12,
    attribution: "Translink, Queensland · CC BY 4.0", source: "https://translink.com.au/about-translink/open-data", alertsUrl: "https://translink.com.au/service-updates", timezone: "Australia/Brisbane",
    schedules: [qld("SEQ")], realtime: [{ id: "SEQ", vehicles: "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions", alerts: "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/alerts" }] },
  { id: "cairns", name: "Cairns", center: [-16.9203, 145.771], zoom: 12,
    attribution: "Translink, Queensland · CC BY 4.0", source: "https://translink.com.au/about-translink/open-data", alertsUrl: "https://translink.com.au/service-updates", timezone: "Australia/Brisbane",
    schedules: [qld("CNS")], realtime: [{ id: "CNS", vehicles: "https://gtfsrt.api.translink.com.au/api/realtime/CNS/VehiclePositions", alerts: "https://gtfsrt.api.translink.com.au/api/realtime/CNS/alerts" }] },
  { id: "qld-regional", name: "Regional Queensland & island ferries", center: [-22.5, 146.5], zoom: 6,
    attribution: "Translink, Queensland · CC BY 4.0", source: "https://translink.com.au/about-translink/open-data", alertsUrl: "https://translink.com.au/service-updates", timezone: "Australia/Brisbane",
    schedules: ["BOW", "BUN", "GLT", "GYM", "INN", "KIL", "MKY", "MAG", "MIF", "MAL", "MHB", "NSI", "RKY", "TWB", "TSV", "WAR", "WHT"].map(qld), realtime: [] },
  { id: "adelaide", name: "Adelaide", center: [-34.9285, 138.6007], zoom: 12,
    attribution: "Adelaide Metro – Department for Infrastructure and Transport, South Australia", source: "https://www.adelaidemetro.com.au/developer-info", alertsUrl: "https://www.adelaidemetro.com.au/service-disruptions", timezone: "Australia/Adelaide",
    schedules: [{ id: "adelaide", url: "https://gtfs.adelaidemetro.com.au/v1/static/latest/google_transit.zip" }],
    realtime: [{ id: "adelaide", vehicles: "https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions", alerts: "https://gtfs.adelaidemetro.com.au/v1/realtime/service_alerts" }] },
  { id: "perth", name: "Perth", center: [-31.9523, 115.8613], zoom: 12,
    attribution: "PTA data is available free of charge from www.transperth.wa.gov.au", source: "https://www.transperth.wa.gov.au/About/Spatial-Data-Access", alertsUrl: "https://www.transperth.wa.gov.au/Service-Updates", timezone: "Australia/Perth",
    schedules: [{ id: "perth", url: "https://www.transperth.wa.gov.au/TimetablePDFs/GoogleTransit/Production/google_transit.zip" }], realtime: [] },
  { id: "tasmania", name: "Tasmania", center: [-42.8821, 147.3272], zoom: 12,
    attribution: "Tasmanian Government · CC BY 4.0", source: "https://www.transport.tas.gov.au/public_transport/gtfs-data", alertsUrl: "https://www.transport.tas.gov.au/public_transport", timezone: "Australia/Hobart",
    schedules: [{ id: "tasmania", url: "https://www.transport.tas.gov.au/__data/assets/file/0011/557615/tas_gtfs.zip" }], realtime: [] },
  { id: "darwin", name: "Darwin & Palmerston", center: [-12.4634, 130.8456], zoom: 12,
    attribution: "Northern Territory Government · CC BY 4.0", source: "https://dli.nt.gov.au/data/bus-timetable-data-and-geographic-information", alertsUrl: "https://nt.gov.au/driving/public-transport-cycling", timezone: "Australia/Darwin",
    schedules: [{ id: "darwin", url: "https://dli.nt.gov.au/data-feeds/bus-gtfs/google-transit-darwin.zip" }], realtime: [] },
  { id: "alice-springs", name: "Alice Springs", center: [-23.698, 133.881], zoom: 13,
    attribution: "Northern Territory Government · CC BY 4.0", source: "https://dli.nt.gov.au/data/bus-timetable-data-and-geographic-information", alertsUrl: "https://nt.gov.au/driving/public-transport-cycling", timezone: "Australia/Darwin",
    schedules: [{ id: "alice", url: "https://dli.nt.gov.au/data-feeds/bus-gtfs/google-transit-alice.zip" }], realtime: [] },
  { id: "canberra", name: "Canberra", center: [-35.2809, 149.13], zoom: 12,
    attribution: "Transport Canberra", source: "https://www.transport.act.gov.au/contact-us/information-for-developers", alertsUrl: "https://www.transport.act.gov.au/service-alerts", timezone: "Australia/Sydney",
    setup: "The new MyWay+ data API needs developer access. Timetable import and live feeds are not connected yet.", schedules: [], realtime: [] },
];

export function nswKey() {
  return process.env.NSW_TRANSPORT_API_KEY || process.env.TRANSPORT_NSW_API_KEY || process.env.TFNSW_API_KEY || process.env.NSW_OPENDATA_API_KEY;
}
export function modeForRoute(type) {
  const n = Number(type);
  if (n === 0 || (n >= 900 && n < 1000)) return "tram";
  if (n === 1 || (n >= 400 && n < 500)) return "metro";
  if (n === 2 || (n >= 100 && n < 200)) return "train";
  if (n === 4 || (n >= 1000 && n < 1100) || n === 1200) return "ferry";
  if (n === 3 || (n >= 200 && n < 300) || (n >= 700 && n < 900)) return "bus";
  return "other";
}

// Generator avoids allocating millions of stop_time objects at once.
export function* csvRows(text) {
  let row = [], field = "", quoted = false, headers;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (ch === "," && !quoted) { row.push(field); field = ""; }
    else if (i === text.length || ((ch === "\n" || ch === "\r") && !quoted)) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(Boolean)) {
        if (!headers) headers = row.map(v => v.replace(/^\uFEFF/, "").trim());
        else yield Object.fromEntries(headers.map((h, j) => [h, row[j] ?? ""]));
      }
      row = []; field = "";
    } else field += ch;
  }
}
