import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const GTFS_ZIP_PATH = path.resolve("gtfs.zip");
const OUTPUT_PATH = path.resolve("src/lib/gtfs-shapes.ts");
const MODE_FOLDER = "2/";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows[0].map((value, index) => (index === 0 ? value.replace(/^﻿/, "") : value));
  return rows.slice(1).map((r) =>
    Object.fromEntries(headers.map((h, idx) => [h, r[idx] ?? ""]))
  );
}

function readZipText(zip, entryName) {
  const entry = zip.getEntry(entryName);
  if (!entry) throw new Error(`Missing entry: ${entryName}`);
  return zip.readAsText(entry);
}

function normaliseRouteName(name) {
  return name
    .toLowerCase()
    .replace(/\s+line$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sortShapePoints(points) {
  return points.sort(
    (a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence)
  );
}

function longestShapeForRoute(routeId, trips, shapesById) {
  const routeTrips = trips.filter((t) => t.route_id === routeId && t.shape_id);
  const seen = new Set();
  const candidates = [];

  for (const trip of routeTrips) {
    if (seen.has(trip.shape_id)) continue;
    seen.add(trip.shape_id);

    const pts = shapesById.get(trip.shape_id) ?? [];
    if (!pts.length) continue;

    candidates.push({
      shapeId: trip.shape_id,
      count: pts.length,
      pts,
    });
  }

  candidates.sort((a, b) => b.count - a.count);
  return candidates[0] ?? null;
}

const zip = new AdmZip(GTFS_ZIP_PATH);

const routes = parseCsv(readZipText(zip, `${MODE_FOLDER}routes.txt`));
const trips = parseCsv(readZipText(zip, `${MODE_FOLDER}trips.txt`));
const shapes = parseCsv(readZipText(zip, `${MODE_FOLDER}shapes.txt`));

const targetRoutes = [
  "Mernda",
  "Hurstbridge",
  "Frankston",
  "Cranbourne",
  "Pakenham",
  "Sunbury",
  "Craigieburn",
  "Upfield",
  "Lilydale",
  "Belgrave",
  "Alamein",
  "Glen Waverley",
  "Sandringham",
  "Werribee",
  "Williamstown",
];

const shapesById = new Map();
for (const row of shapes) {
  const arr = shapesById.get(row.shape_id) ?? [];
  arr.push(row);
  shapesById.set(row.shape_id, arr);
}

const out = {};

for (const routeName of targetRoutes) {
  const route = routes.find(
    // GTFS has no route_name column; match the long or short name.
    (r) =>
      normaliseRouteName(r.route_long_name || "") === normaliseRouteName(routeName) ||
      normaliseRouteName(r.route_short_name || "") === normaliseRouteName(routeName)
  );

  if (!route) {
    console.warn(`No route found for ${routeName}`);
    continue;
  }

  const chosen = longestShapeForRoute(route.route_id, trips, shapesById);
  if (!chosen) {
    console.warn(`No shape found for ${routeName}`);
    continue;
  }

  const coords = sortShapePoints(chosen.pts).map((p) => [
    Number(p.shape_pt_lat),
    Number(p.shape_pt_lon),
  ]);

  out[routeName] = {
    routeId: route.route_id,
    routeName: route.route_name,
    shapeId: chosen.shapeId,
    points: coords,
  };
}

const file = `// Auto-generated from Victoria GTFS Schedule
export const GTFS_SHAPES = ${JSON.stringify(out, null, 2)} as const;
`;

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, file, "utf8");

console.log(`Wrote ${OUTPUT_PATH}`);