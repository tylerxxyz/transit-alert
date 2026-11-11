import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const sourcePath = path.resolve(".local-host/gtfs.zip");
const outputPath = path.resolve("src/lib/generated-vline-gtfs.ts");

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
  const headers = rows.shift().map((value) => value.replace(/^\uFEFF/, ""));
  return rows.map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""])));
}

const outer = new AdmZip(sourcePath);
const regional = new AdmZip(outer.readFile(outer.getEntry("1/google_transit.zip")));
const read = (name) => csv(regional.readAsText(regional.getEntry(name)));
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
const tripsByRoute = new Map();
const tripRoute = new Map();
for (const trip of trips) {
  tripRoute.set(trip.trip_id, trip.route_id);
  const list = tripsByRoute.get(trip.route_id) ?? [];
  list.push(trip); tripsByRoute.set(trip.route_id, list);
}
const stopIdsByRoute = new Map();
for (const stopTime of stopTimes) {
  const routeId = tripRoute.get(stopTime.trip_id);
  if (!routeId) continue;
  const ids = stopIdsByRoute.get(routeId) ?? new Set();
  ids.add(stopTime.stop_id); stopIdsByRoute.set(routeId, ids);
}
const stopById = new Map(stops.map((stop) => [stop.stop_id, stop]));

const generatedRoutes = routes.map((route) => {
  const candidates = [...new Set((tripsByRoute.get(route.route_id) ?? []).map((trip) => trip.shape_id).filter(Boolean))]
    .map((shapeId) => ({ shapeId, points: shapePoints.get(shapeId) ?? [] }))
    .sort((a, b) => b.points.length - a.points.length);
  const chosen = candidates[0];
  return {
    id: route.route_id,
    shortName: route.route_short_name,
    longName: route.route_long_name,
    color: `#${route.route_color || "8F1A95"}`,
    shape: (chosen?.points ?? [])
      .sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence))
      .map((point) => [Number(point.shape_pt_lat), Number(point.shape_pt_lon)]),
    stations: [...(stopIdsByRoute.get(route.route_id) ?? [])]
      .map((id) => stopById.get(id))
      .filter(Boolean)
      .map((stop) => ({ name: stop.stop_name, position: [Number(stop.stop_lat), Number(stop.stop_lon)] }))
      .filter((stop) => Number.isFinite(stop.position[0]) && Number.isFinite(stop.position[1])),
  };
}).filter((route) => route.shape.length > 1);

fs.writeFileSync(outputPath, `// Auto-generated from the installed Transport Victoria GTFS regional rail feed.\nexport const GENERATED_VLINE_GTFS = ${JSON.stringify(generatedRoutes)} as const;\n`);
console.log(`Wrote ${generatedRoutes.length} V/Line rail routes to ${outputPath}`);
