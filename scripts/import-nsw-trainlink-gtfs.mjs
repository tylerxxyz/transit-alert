import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

// Source: Transport for NSW Open Data static GTFS schedule for "nswtrains"
// (https://api.transport.nsw.gov.au/v1/gtfs/schedule/nswtrains), fetched
// with the same NSW_TRANSPORT_API_KEY already used for the live NSW
// TrainLink vehicle-positions feed. Re-fetch with:
//   curl -H "Authorization: apikey $NSW_TRANSPORT_API_KEY" \
//     "https://api.transport.nsw.gov.au/v1/gtfs/schedule/nswtrains" \
//     -o .local-host/nsw-gtfs.zip
const sourcePath = path.resolve(".local-host/nsw-gtfs.zip");
const outputPath = path.resolve("src/lib/generated-nsw-trainlink-gtfs.ts");

// The Sydney-Melbourne XPT's real GTFS identity: route_long_name "Southern
// NSW", vehicle_category_id starting "XPT" (as opposed to the Canberra/
// Griffith XPLORER services which share the same "Southern NSW" long name
// but a different vehicle_category_id). route_short_name is the real XPT
// service number already shown elsewhere in the app (e.g. "623").
const XPT_ROUTE_IDS = ["4T.T.ST21", "4T.T.ST22", "4T.T.ST23", "4T.T.ST24"];

function csv(text) {
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
  // Flush the last row when the file doesn't end with a newline; it used to
  // be dropped silently.
  if (field || row.length) { row.push(field); if (row.some(Boolean)) rows.push(row); }
  const headers = rows.shift().map((value) => value.replace(/^﻿/, ""));
  return rows.map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""])));
}

const zip = new AdmZip(sourcePath);
const read = (name) => csv(zip.readAsText(name));
const routes = read("routes.txt");
const trips = read("trips.txt");
const shapes = read("shapes.txt");
const stops = read("stops.txt");
const stopTimes = read("stop_times.txt");

const shapePoints = new Map();
for (const point of shapes) {
  const list = shapePoints.get(point.shape_id) ?? [];
  list.push(point); shapePoints.set(point.shape_id, list);
}
const stopById = new Map(stops.map((stop) => [stop.stop_id, stop]));
const stopTimesByTrip = new Map();
for (const stopTime of stopTimes) {
  const list = stopTimesByTrip.get(stopTime.trip_id) ?? [];
  list.push(stopTime); stopTimesByTrip.set(stopTime.trip_id, list);
}
const routeById = new Map(routes.map((route) => [route.route_id, route]));

const generatedRoutes = XPT_ROUTE_IDS.map((routeId) => {
  const route = routeById.get(routeId);
  const routeTrips = trips.filter((trip) => trip.route_id === routeId && trip.vehicle_category_id?.startsWith("XPT"));
  // A handful of trips per timetable period are truncated/replacement runs
  // with far fewer stops than the real daily working — take the trip with
  // the most stop_times rows so a one-off doesn't stand in for the real
  // pattern (same heuristic import-vline-gtfs.mjs uses for shape length).
  const bestTrip = routeTrips
    .map((trip) => ({ trip, stopTimes: (stopTimesByTrip.get(trip.trip_id) ?? []).sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence)) }))
    .sort((a, b) => b.stopTimes.length - a.stopTimes.length)[0];
  if (!route || !bestTrip) return null;

  const shapePointsForTrip = (shapePoints.get(bestTrip.trip.shape_id) ?? [])
    .sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence));

  return {
    id: route.route_id,
    shortName: route.route_short_name,
    longName: bestTrip.trip.trip_headsign || route.route_long_name,
    color: `#${route.route_color || "F6891F"}`,
    shape: shapePointsForTrip.map((point) => [Number(point.shape_pt_lat), Number(point.shape_pt_lon)]),
    // fetchTrainTrip only queries PTV's Victorian timetable API, which has
    // no record of a NSW TrainLink trip ID, so the live per-stop match the
    // rest of the app relies on (tripStop) is always empty for this fleet —
    // that's what was rendering every stop as "Time TBC" / "Schedule
    // unavailable". Carrying the real scheduled arrival/departure/platform
    // straight from stop_times.txt/stops.txt lets the UI fall back to
    // Transport for NSW's own published schedule instead of a blank state.
    stations: bestTrip.stopTimes
      .map((stopTime) => ({ stop: stopById.get(stopTime.stop_id), stopTime }))
      .filter((entry) => entry.stop)
      .map(({ stop, stopTime }) => ({
        name: stop.stop_name.replace(/, Platform \d+$/i, ""),
        position: [Number(stop.stop_lat), Number(stop.stop_lon)],
        scheduledArrival: stopTime.arrival_time || null,
        scheduledDeparture: stopTime.departure_time || null,
        platform: stop.platform_code || null,
        pickupType: stopTime.pickup_type || "0",
        dropOffType: stopTime.drop_off_type || "0",
      }))
      .filter((stop) => Number.isFinite(stop.position[0]) && Number.isFinite(stop.position[1])),
  };
}).filter((route) => route && route.shape.length > 1);

fs.writeFileSync(outputPath, `// Auto-generated from Transport for NSW's real static GTFS schedule for the\n// Sydney-Melbourne XPT (route_long_name "Southern NSW", vehicle_category_id\n// "XPT*"). See scripts/import-nsw-trainlink-gtfs.mjs for how to refresh this.\nexport const GENERATED_NSW_TRAINLINK_GTFS = ${JSON.stringify(generatedRoutes)} as const;\n`);
console.log(`Wrote ${generatedRoutes.length} NSW TrainLink XPT routes to ${outputPath}`);
for (const route of generatedRoutes) {
  console.log(`  ${route.shortName} (${route.longName}): ${route.stations.length} stations`);
}
