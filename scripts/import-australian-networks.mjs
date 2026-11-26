import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { gzipSync } from "node:zlib";
import { NETWORKS, csvRows, modeForRoute, nswKey } from "../api/_lib/australian-networks.js";

const target = path.resolve("public/networks");
await fs.mkdir(target, { recursive: true });
const shapeTarget = path.resolve("data/networks");
await fs.mkdir(shapeTarget, { recursive: true });
const selected = process.argv.slice(2);
let failed = false;
for (const network of NETWORKS.filter(n => !selected.length || selected.includes(n.id))) {
  if (!network.schedules.length) continue;
  const stops = new Map(), routes = [], sources = [], failures = [];
  for (const feed of network.schedules) {
    try {
      if (feed.auth === "nsw" && !nswKey()) throw new Error("NSW Transport API key required");
      console.log(`Importing ${network.id}/${feed.id}`);
      const response = await fetch(feed.url, { headers: feed.auth === "nsw" ? { Authorization: `apikey ${nswKey()}` } : {}, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
      const read = name => {
        const entry = zip.getEntries().find(e => e.entryName === name || e.entryName.endsWith(`/${name}`));
        return entry ? zip.readAsText(entry) : "";
      };
      if (!read("routes.txt") || !read("stops.txt")) throw new Error("Archive has no routes/stops");
      const scoped = id => `${feed.id}:${id}`;
      const routeById = new Map();
      for (const row of csvRows(read("routes.txt"))) {
        const route = { id: scoped(row.route_id), sourceId: row.route_id, feed: feed.id, name: row.route_short_name || row.route_long_name || row.route_id, description: row.route_long_name || "", mode: feed.mode || modeForRoute(row.route_type), color: /^[a-f\d]{6}$/i.test(row.route_color) ? `#${row.route_color}` : "#38bdf8", stops: new Set(), shapeId: "" };
        routeById.set(row.route_id, route);
      }
      const localStops = new Map();
      for (const row of csvRows(read("stops.txt"))) {
        const lat = Number(row.stop_lat), lng = Number(row.stop_lon);
        if (!row.stop_lat || !row.stop_lon || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -44 || lat > -9 || lng < 112 || lng > 154) continue;
        localStops.set(row.stop_id, { id: scoped(row.stop_id), name: row.stop_name || row.stop_id, lat: +lat.toFixed(6), lng: +lng.toFixed(6), platform: row.platform_code || "", modes: new Set(), routes: new Set() });
      }
      const shapeText = read("shapes.txt");
      const shapeSizes = new Map();
      for (const row of csvRows(shapeText)) shapeSizes.set(row.shape_id, (shapeSizes.get(row.shape_id) || 0) + 1);
      const trips = new Map(), wantedShapes = new Set();
      for (const row of csvRows(read("trips.txt"))) {
        trips.set(row.trip_id, row.route_id);
        const route = routeById.get(row.route_id);
        if (route && row.shape_id && (!route.shapeId || (shapeSizes.get(row.shape_id) || 0) > (shapeSizes.get(route.shapeId) || 0))) route.shapeId = row.shape_id;
      }
      for (const row of csvRows(read("stop_times.txt"))) {
        const route = routeById.get(trips.get(row.trip_id)), stop = localStops.get(row.stop_id);
        if (route && stop) { route.stops.add(stop.id); stop.routes.add(route.id); stop.modes.add(route.mode); }
      }
      for (const route of routeById.values()) if (route.shapeId) wantedShapes.add(route.shapeId);
      const shapes = new Map();
      for (const row of csvRows(shapeText)) {
        if (!wantedShapes.has(row.shape_id)) continue;
        const points = shapes.get(row.shape_id) || [];
        points.push([Number(row.shape_pt_sequence), Number(row.shape_pt_lat), Number(row.shape_pt_lon)]);
        shapes.set(row.shape_id, points);
      }
      for (const route of routeById.values()) {
        const points = (shapes.get(route.shapeId) || []).sort((a, b) => a[0] - b[0]);
        const step = Math.max(1, Math.ceil(points.length / 500));
        const shape = points.filter((_, i) => i % step === 0 || i === points.length - 1).map(p => [+p[1].toFixed(5), +p[2].toFixed(5)]).filter(p => p.every(Number.isFinite));
        const { shapeId, ...rest } = route;
        routes.push({ ...rest, stops: [...route.stops], shape });
      }
      for (const stop of localStops.values()) stops.set(stop.id, { ...stop, modes: [...stop.modes], routes: [...stop.routes] });
      let serviceEnd = "";
      for (const row of csvRows(read("calendar.txt"))) if (row.end_date > serviceEnd) serviceEnd = row.end_date;
      for (const row of csvRows(read("calendar_dates.txt"))) if (row.exception_type === "1" && row.date > serviceEnd) serviceEnd = row.date;
      sources.push({ id: feed.id, url: feed.url, serviceEnd });
    } catch (error) {
      failed = true;
      failures.push({ id: feed.id, error: error.message });
      console.error(`${network.id}/${feed.id}: ${error.message}`);
    }
  }
  // Never replace an existing usable index with an entirely failed refresh.
  if (!sources.length) continue;
  const geometry = Object.fromEntries(routes.map(route => [route.id, route.shape]));
  const result = { network: network.id, importedAt: new Date().toISOString(), sources, failures, stops: [...stops.values()], routes: routes.map(({ shape, ...route }) => route) };
  const geometryFile = path.join(shapeTarget, `${network.id}.json.gz`);
  await fs.writeFile(`${geometryFile}.tmp`, gzipSync(JSON.stringify(geometry)));
  await fs.rename(`${geometryFile}.tmp`, geometryFile);
  const file = path.join(target, `${network.id}.json`);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(result));
  await fs.rename(`${file}.tmp`, file);
  console.log(`${network.name}: ${stops.size} stops, ${routes.length} routes, ${failures.length} failed feeds`);
}
if (failed) process.exitCode = 1;
